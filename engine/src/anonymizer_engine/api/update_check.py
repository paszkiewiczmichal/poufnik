"""Optional release update check."""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from urllib.error import URLError
from urllib.request import urlopen

LOGGER = logging.getLogger(__name__)

UPDATE_CHECK_ENV = "ANONYMIZER_UPDATE_CHECK"
UPDATE_MANIFEST_URL_ENV = "ANONYMIZER_UPDATE_MANIFEST_URL"
DEFAULT_UPDATE_MANIFEST_URL = (
    "https://api.github.com/repos/paszkiewiczmichal/poufnik/releases/latest"
)
DEFAULT_INTERVAL_SECONDS = 24 * 60 * 60
DEFAULT_TIMEOUT_SECONDS = 5.0

LatestVersionFetcher = Callable[[str, float], str | None]


@dataclass(frozen=True)
class UpdateSnapshot:
    update_available: bool = False
    latest_version: str | None = None


class UpdateChecker:
    def __init__(
        self,
        *,
        current_version: str,
        enabled: bool,
        manifest_url: str,
        fetcher: LatestVersionFetcher | None = None,
        interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self.current_version = current_version
        self.enabled = enabled
        self.manifest_url = manifest_url
        self.fetcher = fetcher or fetch_latest_version
        self.interval_seconds = interval_seconds
        self.timeout_seconds = timeout_seconds
        self._snapshot = UpdateSnapshot()
        self._lock = threading.Lock()
        self._started = False

    @classmethod
    def from_env(
        cls,
        *,
        current_version: str,
        fetcher: LatestVersionFetcher | None = None,
    ) -> UpdateChecker:
        return cls(
            current_version=current_version,
            enabled=_env_bool(os.environ.get(UPDATE_CHECK_ENV), default=False),
            manifest_url=os.environ.get(UPDATE_MANIFEST_URL_ENV, DEFAULT_UPDATE_MANIFEST_URL),
            fetcher=fetcher,
        )

    def start(self) -> None:
        if not self.enabled:
            return
        with self._lock:
            if self._started:
                return
            self._started = True
        thread = threading.Thread(target=self._run_forever, name="update-check", daemon=True)
        thread.start()

    def check_once(self) -> None:
        if not self.enabled:
            return
        try:
            latest_version = self.fetcher(self.manifest_url, self.timeout_seconds)
        except (OSError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            LOGGER.debug("Update check failed: %s", exc)
            return
        except Exception as exc:
            LOGGER.debug("Update check failed with unexpected error: %s", exc)
            return

        if not latest_version:
            return

        update_available = _version_is_newer(latest_version, self.current_version)
        with self._lock:
            self._snapshot = UpdateSnapshot(
                update_available=update_available,
                latest_version=latest_version,
            )
        if update_available:
            LOGGER.info("Anonymizer Engine update available: %s", latest_version)
        else:
            LOGGER.info(
                "Anonymizer Engine update check completed; latest version: %s",
                latest_version,
            )

    def snapshot(self) -> UpdateSnapshot:
        with self._lock:
            return self._snapshot

    def _run_forever(self) -> None:
        while True:
            self.check_once()
            time.sleep(self.interval_seconds)


def fetch_latest_version(url: str, timeout_seconds: float) -> str | None:
    with urlopen(url, timeout=timeout_seconds) as response:  # noqa: S310
        payload = json.loads(response.read().decode("utf-8"))
    return _read_latest_version(payload)


def _read_latest_version(payload: object) -> str | None:
    if isinstance(payload, list):
        for item in payload:
            version = _read_latest_version(item)
            if version:
                return version
        return None
    if not isinstance(payload, dict):
        return None
    for key in ("tag_name", "version", "latest_version", "name"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _env_bool(value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().casefold() in {"1", "true", "yes", "on"}


def _version_is_newer(candidate: str, current: str) -> bool:
    candidate_parts = _version_parts(candidate)
    current_parts = _version_parts(current)
    return candidate_parts > current_parts


def _version_parts(value: str) -> tuple[int, ...]:
    stripped = value.strip().lstrip("vV")
    parts = [int(match.group()) for match in re.finditer(r"\d+", stripped)]
    return tuple(parts or [0])
