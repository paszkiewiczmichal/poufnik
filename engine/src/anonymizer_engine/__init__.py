"""Anonymizer engine package."""

from __future__ import annotations

import os
from importlib.metadata import PackageNotFoundError, version

__all__ = ["__version__"]


def _resolve_version() -> str:
    configured = os.environ.get("ANONYMIZER_ENGINE_VERSION")
    if configured:
        return configured
    try:
        return version("anonymizer-engine")
    except PackageNotFoundError:
        return "0.1.0"


__version__ = _resolve_version()
