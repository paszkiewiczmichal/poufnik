"""Command-line entry point for sidecar and on-prem serving."""

from __future__ import annotations

import argparse
import json
import logging
import secrets
import socket
from pathlib import Path

import uvicorn

from anonymizer_engine.api.app import create_app
from anonymizer_engine.api.config import ensure_api_key, get_config_dir, rotate_api_key

LOGGER = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(prog="anonymizer-engine")
    parser.add_argument("command", nargs="?", choices=["rotate-key"])
    parser.add_argument("--mode", choices=["sidecar", "serve"], default="serve")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8710)
    args = parser.parse_args()

    if args.command == "rotate-key":
        logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
        _rotate_key()
        return
    if args.mode == "sidecar":
        logging.basicConfig(level=logging.ERROR, format="%(levelname)s %(message)s")
        _run_sidecar(port=args.port)
        return
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    _run_serve(host=args.host, port=args.port)


def _run_sidecar(*, port: int) -> None:
    token = secrets.token_urlsafe(32)
    host = "127.0.0.1"
    actual_port = _select_local_port(host) if port == 0 else port
    app = create_app(api_key=token, config_dir=get_config_dir())
    print(json.dumps({"port": actual_port, "token": token}), flush=True)
    uvicorn.run(app, host=host, port=actual_port, access_log=False, log_config=None)


def _run_serve(*, host: str, port: int) -> None:
    config_dir = get_config_dir()
    api_key, path, created = ensure_api_key(config_dir)
    if created:
        LOGGER.info(
            "Generated first-run API key at %s. Use HTTP header X-Api-Key: %s",
            Path(path),
            api_key,
        )
    else:
        LOGGER.info("Loaded API key configuration from %s", Path(path))
    app = create_app(api_key=api_key, config_dir=config_dir, reload_api_key_from_config=True)
    uvicorn.run(app, host=host, port=port, access_log=False)


def _select_local_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def _rotate_key() -> None:
    config_dir = get_config_dir()
    api_key, path, had_previous_key = rotate_api_key(config_dir)
    if had_previous_key:
        LOGGER.info("Rotated API key configuration at %s. Previous key is invalid.", Path(path))
    else:
        LOGGER.info("Generated API key configuration at %s.", Path(path))
    print(api_key, flush=True)


if __name__ == "__main__":
    main()
