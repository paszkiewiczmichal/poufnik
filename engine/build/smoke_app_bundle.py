"""Smoke-test the engine inside a finished macOS Poufnik build.

build_sidecar.py tests the staged sidecar before Tauri bundles it; this runs the same
checks (startup, health, text detection, OCR through the bundled Tesseract) against what
Tauri actually produced. Pass the DMG to test exactly what users download (with
`--bundles dmg` Tauri deletes the intermediate .app), or a Poufnik.app directly.

Usage: python build/smoke_app_bundle.py path/to/Poufnik_X.Y.Z_arch.dmg | path/to/Poufnik.app
"""

from __future__ import annotations

import plistlib
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
    check_minimum_macos(app)
    binaries_dir = app / "Contents" / "Resources" / "binaries"
    sidecar_exe = binaries_dir / MACOS_ENGINE_DIR / SIDECAR_NAME
    tesseract_exe = binaries_dir / "tesseract" / "tesseract"
    for path in (sidecar_exe, tesseract_exe):
        if not path.is_file():
            raise SystemExit(f"Missing from the app bundle: {path}")
    smoke_test_process(sidecar_exe, tesseract_exe, cwd=binaries_dir)
    print(f"App bundle smoke test passed: {app}")


# The engine's Python extensions and Tesseract's dylibs come from Homebrew and PyPI wheels
# built for the runner's own macOS, so they can need a newer system than the one Tauri
# writes into Info.plist. The app would then install on an older Mac and its engine would
# not start, so the build fails here instead.
def check_minimum_macos(app: Path) -> None:
    with (app / "Contents" / "Info.plist").open("rb") as handle:
        declared = plistlib.load(handle).get("LSMinimumSystemVersion", "10.13")
    too_new: list[str] = []
    highest = "0"
    for path in sorted(app.rglob("*")):
        if path.is_symlink() or not path.is_file() or not is_macho(path):
            continue
        for required in macho_minimum_versions(path):
            highest = max(highest, required, key=version_tuple)
            if version_tuple(required) > version_tuple(declared):
                too_new.append(f"{path.relative_to(app)} needs macOS {required}")
    if too_new:
        listing = "\n".join(sorted(set(too_new)))
        raise SystemExit(
            f"Info.plist declares LSMinimumSystemVersion {declared}, but:\n{listing}\n"
            "Raise bundle.macOS.minimumSystemVersion in desktop/src-tauri/tauri.macos.conf.json."
        )
    print(f"Minimum macOS OK: Info.plist {declared}, binaries need at most {highest}")


MACHO_MAGICS = {
    b"\xfe\xed\xfa\xce",
    b"\xce\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf",
    b"\xcf\xfa\xed\xfe",
    b"\xca\xfe\xba\xbe",
}


def is_macho(path: Path) -> bool:
    with path.open("rb") as handle:
        return handle.read(4) in MACHO_MAGICS


def macho_minimum_versions(path: Path) -> list[str]:
    # vtool lists every architecture of a universal binary; "minos" comes from
    # LC_BUILD_VERSION, "version" from the older LC_VERSION_MIN_MACOSX.
    result = subprocess.run(
        ["vtool", "-show-build", str(path)], capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        # CAFEBABE is also the magic of Java class files, which vtool rejects.
        return []
    versions = []
    in_version_min = False
    for line in result.stdout.splitlines():
        fields = line.split()
        if fields[:2] == ["cmd", "LC_VERSION_MIN_MACOSX"]:
            in_version_min = True
        elif fields[:1] == ["cmd"]:
            in_version_min = False
        elif len(fields) == 2 and (
            fields[0] == "minos" or (in_version_min and fields[0] == "version")
        ):
            versions.append(fields[1])
    return versions


def version_tuple(version: str) -> tuple[int, ...]:
    parts = tuple(int(part) for part in version.split("."))
    while len(parts) > 1 and parts[-1] == 0:
        parts = parts[:-1]
    return parts


if __name__ == "__main__":
    main()
