"""Generate the OpenAPI schema for the Anonymizer Engine API."""

from __future__ import annotations

import json
from pathlib import Path

from anonymizer_engine.api import create_app


def main() -> None:
    app = create_app(api_key="openapi", require_auth=False, allow_degraded=True)
    schema = app.openapi()
    output_path = Path("../docs/api/openapi.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(schema, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
