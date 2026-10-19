"""Turn the Tauri-built Poufnik.app into a Mac App Store build and package it as a .pkg.

Run after `tauri build --features mas --config src-tauri/tauri.mas.conf.json --bundles app
--no-sign`. The script copies the app, removes what the App Store build must not carry,
embeds the provisioning profile and signs every binary inside out for the App Sandbox: the
engine and Tesseract executables with sandbox inheritance, libraries without entitlements,
the app last with Entitlements.mas.plist. With an installer identity it also builds the
signed .pkg that App Store Connect accepts.

Without a provisioning profile the app gets only the sandbox entitlements, so it can be
signed with any identity (e.g. Developer ID) and launched locally to test the sandbox.
"""

from __future__ import annotations

import argparse
import plistlib
import shutil
import struct
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SRC_TAURI = Path(__file__).resolve().parents[1] / "src-tauri"
APP_ENTITLEMENTS = SRC_TAURI / "Entitlements.mas.plist"
INHERIT_ENTITLEMENTS = SRC_TAURI / "Entitlements.mas.inherit.plist"

# Info.plist keys of the direct build that have no use under the sandbox.
REMOVED_INFO_KEYS = ("NSAppleEventsUsageDescription",)

MH_EXECUTE = 2
_THIN_MAGICS = {b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe"}
_FAT_MAGICS = {b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"}


def main() -> int:
    args = parse_args()
    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    app = out_dir / args.app.name
    if app.exists():
        shutil.rmtree(app)
    subprocess.run(["ditto", str(args.app), str(app)], check=True)

    entitlements = plistlib.loads(APP_ENTITLEMENTS.read_bytes())
    info_path = app / "Contents" / "Info.plist"
    info = plistlib.loads(info_path.read_bytes())
    for key in REMOVED_INFO_KEYS:
        info.pop(key, None)
    # Only HTTPS (exempt encryption), so App Store Connect asks no export compliance question.
    info["ITSAppUsesNonExemptEncryption"] = False
    if args.build_number:
        info["CFBundleVersion"] = args.build_number

    if args.provisioning_profile:
        profile = read_profile(args.provisioning_profile)
        team_id = profile["Entitlements"]["com.apple.developer.team-identifier"]
        app_id = f"{team_id}.{info['CFBundleIdentifier']}"
        if profile["Entitlements"]["com.apple.application-identifier"] != app_id:
            sys.exit(
                f"The provisioning profile is for "
                f"{profile['Entitlements']['com.apple.application-identifier']}, the app is {app_id}."
            )
        shutil.copyfile(args.provisioning_profile, app / "Contents" / "embedded.provisionprofile")
        entitlements["com.apple.application-identifier"] = app_id
        entitlements["com.apple.developer.team-identifier"] = team_id
    info_path.write_bytes(plistlib.dumps(info))

    sign_nested_binaries(app, args.app_identity)
    with tempfile.TemporaryDirectory() as tmp:
        app_entitlements = Path(tmp) / "app.entitlements"
        app_entitlements.write_bytes(plistlib.dumps(entitlements))
        codesign(app, args.app_identity, app_entitlements)
    verify(app)
    print(f"Signed {app} with {args.app_identity!r}")

    if args.installer_identity:
        pkg = out_dir / f"{app.stem}_{info['CFBundleShortVersionString']}_mas.pkg"
        subprocess.run(
            [
                "productbuild",
                "--component",
                str(app),
                "/Applications",
                "--sign",
                args.installer_identity,
                str(pkg),
            ],
            check=True,
        )
        subprocess.run(["pkgutil", "--check-signature", str(pkg)], check=True)
        print(f"Package: {pkg}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--app", type=Path, required=True, help="Poufnik.app built with --features mas")
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--app-identity", required=True, help='e.g. "Apple Distribution: … (TEAMID)"')
    parser.add_argument("--installer-identity", help='e.g. "3rd Party Mac Developer Installer: … (TEAMID)"')
    parser.add_argument("--provisioning-profile", type=Path, help="Mac App Store provisioning profile")
    parser.add_argument("--build-number", help="CFBundleVersion, if it must differ from the version")
    return parser.parse_args()


def read_profile(path: Path) -> dict:
    decoded = subprocess.run(
        ["security", "cms", "-D", "-i", str(path)], check=True, capture_output=True
    ).stdout
    return plistlib.loads(decoded)


def sign_nested_binaries(app: Path, identity: str) -> None:
    """Sign every Mach-O shipped as a resource: libraries first, then the executables.

    The App Store rejects an app whose embedded executables lack the sandbox entitlement, and
    a child of a sandboxed app that is not marked to inherit the sandbox is killed at launch.
    """
    roots = [app / "Contents" / "Resources", app / "Contents" / "Frameworks"]
    files = [path for root in roots if root.exists() for path in sorted(root.rglob("*"))]
    kinds = {path: macho_filetype(path) for path in files if path.is_file() and not path.is_symlink()}
    libraries = [path for path, kind in kinds.items() if kind is not None and kind != MH_EXECUTE]
    executables = [path for path, kind in kinds.items() if kind == MH_EXECUTE]
    if not executables:
        sys.exit("No engine or Tesseract executable found inside the app.")
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda path: codesign(path, identity, None), libraries))
    for path in executables:
        codesign(path, identity, INHERIT_ENTITLEMENTS)
    print(f"Signed {len(libraries)} libraries and {len(executables)} executables")
    for path in executables:
        print(f"  {path.relative_to(app)}")


def codesign(path: Path, identity: str, entitlements: Path | None) -> None:
    command = ["codesign", "--force", "--sign", identity]
    if entitlements is not None:
        command += ["--entitlements", str(entitlements)]
    result = subprocess.run([*command, str(path)], capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"codesign failed for {path}:\n{result.stderr}")


def macho_filetype(path: Path) -> int | None:
    with path.open("rb") as handle:
        header = handle.read(8)
        if header[:4] in _FAT_MAGICS:
            # First architecture slice: its offset is the third big-endian word of the entry.
            handle.seek(8 + 8)
            (offset,) = struct.unpack(">I", handle.read(4))
            handle.seek(offset)
            header = handle.read(8)
        if header[:4] not in _THIN_MAGICS:
            return None
        handle.seek(handle.tell() - 8 + 12)
        (filetype,) = struct.unpack("<I", handle.read(4))
        return filetype


def verify(app: Path) -> None:
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
    executables = [app / "Contents" / "MacOS" / app.stem]
    executables += [
        path
        for path in (app / "Contents" / "Resources").rglob("*")
        if path.is_file() and not path.is_symlink() and macho_filetype(path) == MH_EXECUTE
    ]
    for path in executables:
        dumped = subprocess.run(
            ["codesign", "-d", "--entitlements", "-", "--xml", str(path)],
            check=True,
            capture_output=True,
        ).stdout
        granted = plistlib.loads(dumped) if dumped.strip() else {}
        if granted.get("com.apple.security.app-sandbox") is not True:
            sys.exit(f"{path} is not sandboxed.")


if __name__ == "__main__":
    raise SystemExit(main())
