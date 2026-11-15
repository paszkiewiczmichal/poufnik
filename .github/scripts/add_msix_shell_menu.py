"""Ship the Explorer context-menu handler (poufnik_shell_menu.dll) inside the MSIX.

AppxManifest.xml.template declares a COM surrogate server with Path="poufnik_shell_menu.dll"
for the Windows 11 top-level context menu (Poufnik → Anonimizuj / OCR / Markdown / Przywróć
dane). The DLL is built from desktop/shell-menu before this step and added as a bundle
resource at the package root, the only place the manifest looks for it.

Run in the MSIX build job only: the GitHub installer (NSIS) registers a classic registry menu
instead (desktop/src-tauri/windows/hooks.nsh) and does not need the DLL.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

DLL_NAME = "poufnik_shell_menu.dll"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="Repository root (defaults to the checkout this script lives in).",
    )
    args = parser.parse_args()

    desktop = args.repo_root.resolve() / "desktop"
    dll = desktop / "shell-menu" / "target" / "release" / DLL_NAME
    if not dll.is_file():
        raise SystemExit(
            f"Context-menu DLL not found: {dll}. Build it first: "
            "cargo build --release --manifest-path desktop/shell-menu/Cargo.toml"
        )

    conf_path = desktop / "src-tauri" / "tauri.conf.json"
    conf = json.loads(conf_path.read_text(encoding="utf-8"))
    resources = conf["bundle"].setdefault("resources", {})
    if not isinstance(resources, dict):
        raise SystemExit("bundle.resources must be a source->target map in tauri.conf.json.")

    source_key = f"../shell-menu/target/release/{DLL_NAME}"
    resources[source_key] = DLL_NAME
    conf_path.write_text(json.dumps(conf, indent=2) + "\n", encoding="utf-8")
    print(f"Added MSIX resource {source_key} -> {DLL_NAME}")


if __name__ == "__main__":
    main()
