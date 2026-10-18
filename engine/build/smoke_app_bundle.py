"""Smoke-test the engine inside a finished macOS Poufnik build.

build_sidecar.py tests the staged sidecar before Tauri bundles it; this runs the same
checks (startup, health, text detection, OCR through the bundled Tesseract) against what
Tauri actually produced. Pass the DMG to test exactly what users download (with
`--bundles dmg` Tauri deletes the intermediate .app), or a Poufnik.app directly.

Usage: python build/smoke_app_bundle.py path/to/Poufnik_X.Y.Z_arch.dmg | path/to/Poufnik.app
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_sidecar import MACOS_ENGINE_DIR, SIDECAR_NAME, smoke_test_process  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    target = Path(sys.argv[1]).resolve()
    if target.suffix == ".dmg":
        smoke_test_dmg(target)
    else:
        smoke_test_app(target)


def smoke_test_dmg(dmg: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="poufnik-dmg-") as mount_point:
        subprocess.run(
            ["hdiutil", "attach", str(dmg), "-nobrowse", "-readonly", "-mountpoint", mount_point],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        try:
            apps = sorted(Path(mount_point).glob("*.app"))
            if not apps:
                raise SystemExit(f"No .app inside {dmg}")
            smoke_test_app(apps[0])
        finally:
            subprocess.run(["hdiutil", "detach", mount_point, "-force"], check=False)


def smoke_test_app(app: Path) -> None:
    binaries_dir = app / "Contents" / "Resources" / "binaries"
    sidecar_exe = binaries_dir / MACOS_ENGINE_DIR / SIDECAR_NAME
    tesseract_exe = binaries_dir / "tesseract" / "tesseract"
    for path in (sidecar_exe, tesseract_exe):
        if not path.is_file():
            raise SystemExit(f"Missing from the app bundle: {path}")
    smoke_test_process(sidecar_exe, tesseract_exe, cwd=binaries_dir)
    print(f"App bundle smoke test passed: {app}")


if __name__ == "__main__":
    main()
