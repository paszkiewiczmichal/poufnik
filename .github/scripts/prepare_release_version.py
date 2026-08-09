from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("tag")
    args = parser.parse_args()

    version = args.tag.removeprefix("v")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", version):
        raise SystemExit(f"Tag {args.tag!r} is not a SemVer version prefixed with v.")

    repo = Path(__file__).resolve().parents[2]
    update_json(repo / "desktop" / "src-tauri" / "tauri.conf.json", "version", version)
    update_json(repo / "desktop" / "package.json", "version", version)
    replace_first_version(repo / "desktop" / "src-tauri" / "Cargo.toml", version)
    replace_first_version(repo / "engine" / "pyproject.toml", version)
    print(f"Prepared release version {version}.")


def update_json(path: Path, key: str, version: str) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    data[key] = version
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def replace_first_version(path: Path, version: str) -> None:
    content = path.read_text(encoding="utf-8")
    updated = re.sub(r'(?m)^version = "[^"]+"', f'version = "{version}"', content, count=1)
    if updated == content:
        raise SystemExit(f"Could not update version in {path}.")
    path.write_text(updated, encoding="utf-8")


if __name__ == "__main__":
    main()
