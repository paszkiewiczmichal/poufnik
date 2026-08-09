from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--account", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--description", default="Poufnik")
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[2]
    config_path = repo / "desktop" / "src-tauri" / "tauri.conf.json"
    data = json.loads(config_path.read_text(encoding="utf-8"))

    sign_command = subprocess.list2cmdline(
        [
            "artifact-signing-cli",
            "-e",
            args.endpoint,
            "-a",
            args.account,
            "-c",
            args.profile,
            "-d",
            args.description,
            "%1",
        ]
    )
    data.setdefault("bundle", {}).setdefault("windows", {})["signCommand"] = sign_command
    config_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print("Configured Azure Artifact Signing signCommand for Tauri Windows bundles.")


if __name__ == "__main__":
    main()
