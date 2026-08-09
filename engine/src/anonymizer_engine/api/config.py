"""Configuration helpers for API runtime modes."""

from __future__ import annotations

import os
import secrets
from pathlib import Path

from pydantic import BaseModel

CONFIG_DIR_ENV = "ANONYMIZER_CONFIG_DIR"
CONFIG_FILE_NAME = "config.json"


class EngineConfig(BaseModel):
    api_key: str | None = None
    prompts_path: str | None = None


def get_config_dir() -> Path:
    configured = os.environ.get(CONFIG_DIR_ENV)
    if configured:
        return Path(configured)
    return Path.home() / ".anonymizer"


def config_file_path(config_dir: Path) -> Path:
    return config_dir / CONFIG_FILE_NAME


def load_config(config_dir: Path) -> EngineConfig:
    path = config_file_path(config_dir)
    if not path.exists():
        return EngineConfig()
    return EngineConfig.model_validate_json(path.read_text(encoding="utf-8"))


def save_config(config_dir: Path, config: EngineConfig) -> Path:
    config_dir.mkdir(parents=True, exist_ok=True)
    path = config_file_path(config_dir)
    path.write_text(config.model_dump_json(indent=2), encoding="utf-8")
    return path


def ensure_api_key(config_dir: Path) -> tuple[str, Path, bool]:
    config = load_config(config_dir)
    if config.api_key:
        return config.api_key, config_file_path(config_dir), False

    config.api_key = secrets.token_urlsafe(32)
    path = save_config(config_dir, config)
    return config.api_key, path, True


def rotate_api_key(config_dir: Path) -> tuple[str, Path, bool]:
    config = load_config(config_dir)
    had_previous_key = bool(config.api_key)
    config.api_key = secrets.token_urlsafe(32)
    path = save_config(config_dir, config)
    return config.api_key, path, had_previous_key
