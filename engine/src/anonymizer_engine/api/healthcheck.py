"""Container healthcheck for the authenticated API."""

from __future__ import annotations

import http.client
import json
import os

from anonymizer_engine.api.config import config_file_path, get_config_dir


def main() -> None:
    try:
        config = json.loads(config_file_path(get_config_dir()).read_text(encoding="utf-8"))
        api_key = config["api_key"]
        port = int(os.environ.get("ANONYMIZER_PORT", "8710"))
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        connection.request("GET", "/v1/health", headers={"X-Api-Key": api_key})
        response = connection.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        raise SystemExit(1) from None
    if response.status != 200 or payload.get("status") not in {"ok", "degraded"}:
        raise SystemExit(1)
    raise SystemExit(0)


if __name__ == "__main__":
    main()
