"""Make @choochmeque/tauri-windows-bundle ship the engine sidecar inside the MSIX.

The bundler copies only the main executable, MSIX assets and `bundle.resources`; it ignores
`bundle.externalBin`. Without this step the MSIX has no `anonymizer-engine.exe`, the engine
never starts and the import screen stays disabled (Microsoft Store certification 10.1.2.10).

Run in the MSIX build job only, after the engine sidecar is built. NSIS and macOS bundles keep
using `externalBin`, so adding the file as a resource there would duplicate it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

SIDECAR_NAME = "anonymizer-engine"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-triple", default="x86_64-pc-windows-msvc")
    args = parser.parse_args()

    src_tauri = Path(__file__).resolve().parents[2] / "desktop" / "src-tauri"
    sidecar = src_tauri / "binaries" / f"{SIDECAR_NAME}-{args.target_triple}.exe"
    if not sidecar.is_file():
        raise SystemExit(f"Engine sidecar not found: {sidecar}. Build it before this step.")

    conf_path = src_tauri / "tauri.conf.json"
    conf = json.loads(conf_path.read_text(encoding="utf-8"))
    bundle = conf["bundle"]
    resources = bundle.setdefault("resources", {})
    if not isinstance(resources, dict):
        raise SystemExit("bundle.resources must be a source->target map in tauri.conf.json.")

    source_key = f"binaries/{sidecar.name}"
    resources[source_key] = f"{SIDECAR_NAME}.exe"
    conf_path.write_text(json.dumps(conf, indent=2) + "\n", encoding="utf-8")
    print(f"Added MSIX resource {source_key} -> {SIDECAR_NAME}.exe")


if __name__ == "__main__":
    main()
