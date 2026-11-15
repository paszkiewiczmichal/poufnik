"""Build the identity package (sparse package) for the GitHub installer's context menu.

poufnik-menu.msix carries only a manifest and three logos. Registered by the installer with
Add-AppxPackage -ExternalLocation <installation folder> (poufnik-menu.ps1, hooks.nsh), it lets
Windows 11 show Poufnik at the top level of the Explorer context menu, through the same
poufnik_shell_menu.dll as the Microsoft Store package.

The package must be signed with a certificate whose subject equals --publisher, otherwise
Windows refuses it and the installer falls back to the classic menu. CI signs it with Azure
Artifact Signing; for a local test pass --pfx.

With --add-resources the DLL, the package and poufnik-menu.ps1 are added to bundle.resources
in tauri.conf.json, so the NSIS installer puts them next to Poufnik.exe. Run that only for the
NSIS build, never for the MSIX one.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

SPARSE = Path(__file__).resolve().parent
DESKTOP = SPARSE.parents[1]
STORE_MANIFEST = DESKTOP / "src-tauri" / "gen" / "windows" / "AppxManifest.xml.template"
ASSETS = DESKTOP / "src-tauri" / "gen" / "windows" / "Assets"
TAURI_CONF = DESKTOP / "src-tauri" / "tauri.conf.json"
DLL = DESKTOP / "shell-menu" / "target" / "release" / "poufnik_shell_menu.dll"
OUTPUT = DESKTOP / "shell-menu" / "target" / "poufnik-menu.msix"
LOGOS = ("StoreLogo.png", "Square150x150Logo.png", "Square44x44Logo.png")
CLSID = "d2c5f856-c78a-4afa-bc32-6259d0e125c7"
# Subject of the Azure Artifact Signing certificate that signs the GitHub release.
RELEASE_PUBLISHER = (
    "CN=Kancelaria Radcy Prawnego Michał Paszkiewicz, "
    "O=Kancelaria Radcy Prawnego Michał Paszkiewicz, L=Gdańsk, S=Pomorskie, C=PL"
)


def item_types() -> list[str]:
    """File types of the Store manifest, so both menus cover the same files."""
    types = re.findall(r'<desktop5:ItemType Type="([^"]+)"', STORE_MANIFEST.read_text("utf-8"))
    if not types:
        raise SystemExit(f"No file types found in {STORE_MANIFEST}.")
    return types


def package_version() -> str:
    version = json.loads(TAURI_CONF.read_text("utf-8"))["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"Unexpected version in tauri.conf.json: {version}")
    return f"{version}.0"


def render_manifest(publisher: str, version: str) -> str:
    entries = "\n".join(
        f'            <desktop5:ItemType Type="{extension}">\n'
        f'              <desktop5:Verb Id="Poufnik" Clsid="{CLSID}" />\n'
        f"            </desktop5:ItemType>"
        for extension in item_types()
    )
    template = (SPARSE / "AppxManifest.xml.template").read_text("utf-8")
    manifest = (
        template.replace("{{PUBLISHER}}", escape_xml(publisher))
        .replace("{{VERSION}}", version)
        .replace("{{ITEM_TYPES}}", entries)
    )
    if "{{" in manifest:
        raise SystemExit("A placeholder in the sparse manifest template was not filled.")
    return manifest


def escape_xml(value: str) -> str:
    return value.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


def windows_kit_tool(name: str) -> Path:
    found = sorted(Path(r"C:\Program Files (x86)\Windows Kits\10\bin").glob(f"10.*/x64/{name}"))
    if not found:
        raise SystemExit(f"{name} not found under Windows Kits.")
    return found[-1]


def build(publisher: str, output: Path) -> None:
    with tempfile.TemporaryDirectory() as staging_name:
        staging = Path(staging_name)
        (staging / "AppxManifest.xml").write_text(
            render_manifest(publisher, package_version()), encoding="utf-8"
        )
        (staging / "Assets").mkdir()
        for logo in LOGOS:
            shutil.copy2(ASSETS / logo, staging / "Assets" / logo)
        output.parent.mkdir(parents=True, exist_ok=True)
        # /nv: Poufnik.exe and the DLL live in the installation folder, not in the package,
        # which manifest validation would reject (Microsoft's documented way for sparse packages).
        makeappx = str(windows_kit_tool("makeappx.exe"))
        subprocess.run(
            [makeappx, "pack", "/o", "/nv", "/d", str(staging), "/p", str(output)], check=True
        )
    print(f"Built {output}")


def sign(output: Path, pfx: Path, password_file: Path | None) -> None:
    command = [str(windows_kit_tool("signtool.exe")), "sign", "/fd", "SHA256", "/f", str(pfx)]
    if password_file:
        command += ["/p", password_file.read_text("utf-8").strip()]
    subprocess.run([*command, str(output)], check=True)
    print(f"Signed {output} with {pfx.name}")


def add_resources(output: Path) -> None:
    if not DLL.is_file():
        raise SystemExit(
            f"Context-menu DLL not found: {DLL}. Build it first: "
            "cargo build --release --manifest-path desktop/shell-menu/Cargo.toml"
        )
    conf = json.loads(TAURI_CONF.read_text("utf-8"))
    resources = conf["bundle"].setdefault("resources", {})
    if not isinstance(resources, dict):
        raise SystemExit("bundle.resources must be a source->target map in tauri.conf.json.")
    src_tauri = TAURI_CONF.parent
    for source, target in (
        (DLL, "poufnik_shell_menu.dll"),
        (output, "poufnik-menu.msix"),
        (SPARSE / "poufnik-menu.ps1", "poufnik-menu.ps1"),
    ):
        key = Path(os.path.relpath(source, src_tauri)).as_posix()
        resources[key] = target
        print(f"Added NSIS resource {key} -> {target}")
    TAURI_CONF.write_text(json.dumps(conf, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--publisher", default=RELEASE_PUBLISHER, help="Signing certificate subject.")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--pfx", type=Path, help="Sign with this certificate (local tests).")
    parser.add_argument("--pfx-password-file", type=Path)
    parser.add_argument("--add-resources", action="store_true", help="Ship it in the NSIS installer.")
    args = parser.parse_args()

    build(args.publisher, args.output)
    if args.pfx:
        sign(args.output, args.pfx, args.pfx_password_file)
    if args.add_resources:
        add_resources(args.output)


if __name__ == "__main__":
    main()
