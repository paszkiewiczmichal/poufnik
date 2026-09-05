from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

DISTRIBUTABLE_SUFFIXES = (
    ".exe",
    ".msi",
    ".dmg",
    ".tar.gz",
    ".sig",
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("desktop/src-tauri/target"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    files = [path for path in args.root.rglob("*") if is_release_artifact(path)]
    lines = [f"{sha256(path)}  {release_asset_name(path, args.output)}" for path in sorted(files)]
    args.output.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    print(f"Wrote {len(lines)} checksum entries to {args.output}.")


def is_release_artifact(path: Path) -> bool:
    if not path.is_file() or "bundle" not in path.parts:
        return False
    return path.name == "latest.json" or any(
        str(path).endswith(suffix) for suffix in DISTRIBUTABLE_SUFFIXES
    )


def release_asset_name(path: Path, output: Path) -> str:
    name = path.name
    output_name = output.name
    if "windows-x64" in output_name:
        return name.replace("_x64-setup", "_windows_x64-setup")
    return name


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    main()
