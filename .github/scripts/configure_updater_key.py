from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path


def main() -> None:
    repo = Path(__file__).resolve().parents[2]
    desktop = repo / "desktop"
    config_path = desktop / "src-tauri" / "tauri.conf.json"

    private_key = os.environ.get("TAURI_SIGNING_PRIVATE_KEY", "").strip()
    public_key = os.environ.get("TAURI_SIGNING_PUBLIC_KEY", "").strip()
    if private_key:
        if public_key:
            patch_pubkey(config_path, public_key)
            print("Configured updater public key from TAURI_SIGNING_PUBLIC_KEY.")
        else:
            print("Using updater public key committed in tauri.conf.json.")
        return

    key_path = Path(os.environ["RUNNER_TEMP"]) / "anonymizer-ephemeral-updater.key"
    subprocess.run(
        [
            npm_command(),
            "run",
            "tauri",
            "signer",
            "generate",
            "--",
            "--ci",
            "--force",
            "--write-keys",
            str(key_path),
        ],
        cwd=desktop,
        check=True,
    )
    generated_private = key_path.read_text(encoding="utf-8").strip()
    generated_public = (
        key_path.with_suffix(key_path.suffix + ".pub").read_text(encoding="utf-8").strip()
    )
    patch_pubkey(config_path, generated_public)
    append_env("TAURI_SIGNING_PRIVATE_KEY", generated_private)
    append_env("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "")
    print(
        "::warning::TAURI_SIGNING_PRIVATE_KEY secret is missing. "
        "Using an ephemeral updater key so unsigned CI builds can complete; "
        "do not publish this build as an update source."
    )


def npm_command() -> str:
    candidates = ["npm.cmd", "npm.exe", "npm"] if os.name == "nt" else ["npm"]
    for candidate in candidates:
        path = shutil.which(candidate)
        if path:
            return path
    raise FileNotFoundError("npm was not found on PATH")


def patch_pubkey(config_path: Path, public_key: str) -> None:
    data = json.loads(config_path.read_text(encoding="utf-8"))
    data.setdefault("plugins", {}).setdefault("updater", {})["pubkey"] = public_key
    config_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def append_env(name: str, value: str) -> None:
    env_path = os.environ.get("GITHUB_ENV")
    if not env_path:
        return
    with Path(env_path).open("a", encoding="utf-8") as handle:
        handle.write(f"{name}<<EOF\n{value}\nEOF\n")


if __name__ == "__main__":
    main()
