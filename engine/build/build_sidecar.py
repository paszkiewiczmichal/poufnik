"""Build the anonymizer-engine PyInstaller sidecar for Tauri.

The build intentionally uses PyInstaller onedir mode. Tauri externalBin only points at
the executable, so the PyInstaller support directory and Tesseract runtime are staged as
Tauri bundle resources next to the sidecar binary.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import queue
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterable
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_ROOT = Path(__file__).resolve().parents[1]
ENTRY_POINT = ENGINE_ROOT / "build" / "sidecar_entry.py"
DEFAULT_BINARIES_DIR = REPO_ROOT / "desktop" / "src-tauri" / "binaries"
DIST_ROOT = ENGINE_ROOT / "build" / "dist"
WORK_ROOT = ENGINE_ROOT / "build" / "pyinstaller"
SPEC_ROOT = ENGINE_ROOT / "build" / "spec"
SIDECAR_NAME = "anonymizer-engine"
TESSDATA_FAST_BASE = "https://github.com/tesseract-ocr/tessdata_fast/raw/main"
REQUIRED_TESSDATA = ("pol.traineddata", "eng.traineddata")
REQUIRED_PACKAGED_RESOURCES = (
    (
        ENGINE_ROOT / "src" / "anonymizer_engine" / "detection" / "resources" / "names.db",
        Path("anonymizer_engine") / "detection" / "resources",
    ),
    (
        ENGINE_ROOT / "src" / "anonymizer_engine" / "detection" / "resources" / "places.db",
        Path("anonymizer_engine") / "detection" / "resources",
    ),
    (
        ENGINE_ROOT / "src" / "anonymizer_engine" / "anonymize" / "resources" / "DejaVuSans.ttf",
        Path("anonymizer_engine") / "anonymize" / "resources",
    ),
)


def main() -> None:
    args = parse_args()
    target_triple = args.target_triple or detect_target_triple()
    suffix = ".exe" if target_triple.endswith("windows-msvc") else ""
    binaries_dir = args.out_dir.resolve()

    run_pyinstaller(clean=args.clean)
    prune_unused_pyinstaller_data()
    staged_exe = stage_pyinstaller_output(binaries_dir, target_triple, suffix)
    tesseract_exe = stage_tesseract(
        binaries_dir=binaries_dir,
        tesseract_bin=args.tesseract_bin,
        tessdata_dir=args.tessdata_dir,
    )
    verify_packaged_resources(binaries_dir)

    if not args.no_smoke:
        smoke_test(staged_exe, tesseract_exe)
        smoke_test_tauri_resource_layout(
            binaries_dir=binaries_dir,
            staged_exe=staged_exe,
            suffix=suffix,
        )

    support_size = directory_size(binaries_dir / "_internal")
    tesseract_size = directory_size(binaries_dir / "tesseract")
    print(
        json.dumps(
            {
                "targetTriple": target_triple,
                "sidecar": str(staged_exe),
                "sidecarSizeBytes": staged_exe.stat().st_size,
                "pyinstallerSupportSizeBytes": support_size,
                "tesseract": str(tesseract_exe),
                "tesseractBundleSizeBytes": tesseract_size,
            },
            indent=2,
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-triple", help="Rust target triple suffix expected by Tauri.")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_BINARIES_DIR,
        help="Tauri binaries/resources staging directory.",
    )
    parser.add_argument("--tesseract-bin", type=Path, help="Path to the Tesseract executable.")
    parser.add_argument("--tessdata-dir", type=Path, help="Directory with pol/eng traineddata.")
    parser.add_argument("--no-smoke", action="store_true", help="Skip built sidecar smoke test.")
    parser.add_argument("--clean", action="store_true", help="Clean PyInstaller cache first.")
    return parser.parse_args()


def detect_target_triple() -> str:
    try:
        result = subprocess.run(
            ["rustc", "--print", "host-tuple"],
            check=True,
            capture_output=True,
            text=True,
        )
        triple = result.stdout.strip()
        if triple:
            return triple
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass

    result = subprocess.run(["rustc", "-Vv"], check=True, capture_output=True, text=True)
    for line in result.stdout.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError("Could not determine Rust target triple from rustc.")


def run_pyinstaller(*, clean: bool) -> None:
    for path in (DIST_ROOT / SIDECAR_NAME, WORK_ROOT / SIDECAR_NAME):
        if path.exists():
            shutil.rmtree(path)
    SPEC_ROOT.mkdir(parents=True, exist_ok=True)

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--onedir",
        "--name",
        SIDECAR_NAME,
        "--distpath",
        str(DIST_ROOT),
        "--workpath",
        str(WORK_ROOT),
        "--specpath",
        str(SPEC_ROOT),
        "--contents-directory",
        "_internal",
        "--paths",
        str(ENGINE_ROOT / "src"),
        "--collect-all",
        "anonymizer_engine",
        *packaged_resource_args(),
        "--collect-all",
        "pl_core_news_lg",
        "--collect-data",
        "spacy",
        "--collect-data",
        "presidio_analyzer",
        *presidio_analyzer_conf_args(),
        "--collect-data",
        "pypdfium2",
        "--collect-binaries",
        "pypdfium2",
        "--collect-binaries",
        "pillow_heif",
        "--hidden-import",
        "pillow_heif",
        "--copy-metadata",
        "spacy",
        "--copy-metadata",
        "pl-core-news-lg",
        "--copy-metadata",
        "presidio-analyzer",
        "--hidden-import",
        "pl_core_news_lg",
        "--hidden-import",
        "spacy.lang.pl",
        str(ENTRY_POINT),
    ]
    if clean:
        command.insert(3, "--clean")

    subprocess.run(command, check=True, cwd=ENGINE_ROOT)


UNUSED_PYINSTALLER_DATA_PATHS = (
    # python-docx's own PyPI package ships a dead, pre-exploded copy of its default
    # template (the un-zipped source used to build templates/default.docx at python-docx's
    # own package-build time) alongside the real one, docx/templates/default.docx, that
    # docx/api.py actually opens at runtime - confirmed by grepping the whole docx package
    # source: "templates" appears in exactly that one os.path.join() call, nowhere else.
    # PyInstaller bundles this dead directory anyway since it's just sitting in site-packages.
    # Its contents - [Content_Types].xml, _rels/.rels - are reserved OPC (Open Packaging
    # Conventions) names that collide with the MSIX package's own structure (MSIX is itself
    # an OPC package) and make MakeAppx fail with 0x8007007b when building the Store channel.
    Path("docx") / "templates" / "default-docx-template",
)


def prune_unused_pyinstaller_data() -> None:
    support_dir = DIST_ROOT / SIDECAR_NAME / "_internal"
    for relative in UNUSED_PYINSTALLER_DATA_PATHS:
        target = support_dir / relative
        if target.exists():
            shutil.rmtree(target)


def packaged_resource_args() -> list[str]:
    args: list[str] = []
    for source, destination in REQUIRED_PACKAGED_RESOURCES:
        if not source.exists():
            raise FileNotFoundError(f"Required engine resource not found: {source}")
        args.extend(["--add-data", f"{source}{os.pathsep}{destination.as_posix()}"])
    return args


def presidio_analyzer_conf_args() -> list[str]:
    # --collect-data presidio_analyzer bundles this package's conf/ directory (recognizer
    # definitions the library loads by relative path at runtime, e.g. default_recognizers.yaml)
    # on Windows, but reproducibly does not on macOS - confirmed by inspecting the built
    # bundle, the file is simply absent from _internal/presidio_analyzer/conf/ there. Bundling
    # it explicitly sidesteps whatever PyInstaller/platform interaction causes that gap.
    spec = importlib.util.find_spec("presidio_analyzer")
    if spec is None or not spec.submodule_search_locations:
        raise RuntimeError("presidio_analyzer is not installed in this environment.")
    conf_dir = Path(next(iter(spec.submodule_search_locations))) / "conf"
    if not conf_dir.is_dir():
        raise FileNotFoundError(f"presidio_analyzer conf directory not found: {conf_dir}")
    return ["--add-data", f"{conf_dir}{os.pathsep}presidio_analyzer/conf"]


def stage_pyinstaller_output(binaries_dir: Path, target_triple: str, suffix: str) -> Path:
    app_dir = DIST_ROOT / SIDECAR_NAME
    source_exe = app_dir / f"{SIDECAR_NAME}{suffix}"
    source_support = app_dir / "_internal"
    if not source_exe.exists():
        raise FileNotFoundError(f"PyInstaller executable not found: {source_exe}")
    if not source_support.exists():
        raise FileNotFoundError(f"PyInstaller support directory not found: {source_support}")

    binaries_dir.mkdir(parents=True, exist_ok=True)
    for old in binaries_dir.glob(f"{SIDECAR_NAME}-*"):
        if old.is_file():
            old.unlink()

    target_exe = binaries_dir / f"{SIDECAR_NAME}-{target_triple}{suffix}"
    shutil.copy2(source_exe, target_exe)
    target_exe.chmod(target_exe.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    target_support = binaries_dir / "_internal"
    if target_support.exists():
        shutil.rmtree(target_support)
    shutil.copytree(source_support, target_support)
    return target_exe


def stage_tesseract(
    *,
    binaries_dir: Path,
    tesseract_bin: Path | None,
    tessdata_dir: Path | None,
) -> Path:
    source_exe = resolve_tesseract_binary(tesseract_bin)
    source_tessdata = resolve_tessdata_dir(tessdata_dir, source_exe)

    target_root = binaries_dir / "tesseract"
    if target_root.exists():
        shutil.rmtree(target_root)
    target_root.mkdir(parents=True)

    if platform.system() == "Windows":
        target_exe = copy_windows_tesseract(source_exe, target_root)
    elif platform.system() == "Darwin":
        target_exe = copy_macos_tesseract(source_exe, target_root)
    else:
        target_exe = copy_posix_tesseract(source_exe, target_root)

    target_tessdata = target_root / "tessdata"
    target_tessdata.mkdir(parents=True, exist_ok=True)
    copy_tessdata(source_tessdata, target_tessdata)
    ensure_required_tessdata(target_tessdata)
    return target_exe


def resolve_tesseract_binary(configured: Path | None) -> Path:
    candidates: list[Path] = []
    env_path = os.environ.get("ANONYMIZER_TESSERACT_PATH")
    if configured:
        candidates.append(configured)
    if env_path:
        candidates.append(Path(env_path))
    found = shutil.which("tesseract")
    if found:
        candidates.append(Path(found))
    candidates.extend(
        [
            Path("C:/Program Files/Tesseract-OCR/tesseract.exe"),
            Path("/opt/homebrew/bin/tesseract"),
            Path("/usr/local/bin/tesseract"),
            Path("/usr/bin/tesseract"),
        ]
    )

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate.resolve()
    raise FileNotFoundError(
        "Tesseract executable was not found. Install Tesseract or pass --tesseract-bin."
    )


def resolve_tessdata_dir(configured: Path | None, tesseract_exe: Path) -> Path | None:
    candidates: list[Path] = []
    env_prefix = os.environ.get("TESSDATA_PREFIX")
    if configured:
        candidates.append(configured)
    if env_prefix:
        candidates.append(Path(env_prefix))
        candidates.append(Path(env_prefix) / "tessdata")

    parent = tesseract_exe.parent
    candidates.extend(
        [
            parent / "tessdata",
            parent.parent / "share" / "tessdata",
            parent.parent / "share" / "tessdata_fast",
            Path("C:/Program Files/Tesseract-OCR/tessdata"),
            Path("/opt/homebrew/share/tessdata"),
            Path("/usr/local/share/tessdata"),
            Path("/usr/share/tesseract-ocr/5/tessdata"),
            Path("/usr/share/tesseract-ocr/4.00/tessdata"),
            Path("/usr/share/tessdata"),
        ]
    )

    for candidate in candidates:
        if candidate.exists() and candidate.is_dir():
            return candidate.resolve()
    return None


def copy_windows_tesseract(source_exe: Path, target_root: Path) -> Path:
    source_root = source_exe.parent
    for item in source_root.iterdir():
        if item.name.lower() == "tessdata":
            continue
        target = target_root / item.name
        if item.is_dir():
            shutil.copytree(item, target)
        elif item.suffix.lower() in {".exe", ".dll"} or item.name.lower().startswith("tess"):
            shutil.copy2(item, target)
    target_exe = target_root / source_exe.name
    if not target_exe.exists():
        shutil.copy2(source_exe, target_exe)
    return target_exe


def copy_posix_tesseract(source_exe: Path, target_root: Path) -> Path:
    target_exe = target_root / "tesseract"
    shutil.copy2(source_exe, target_exe)
    target_exe.chmod(target_exe.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return target_exe


def copy_macos_tesseract(source_exe: Path, target_root: Path) -> Path:
    target_exe = copy_posix_tesseract(source_exe, target_root)
    lib_dir = target_root / "lib"
    lib_dir.mkdir()
    copied: dict[Path, Path] = {}

    def copy_dependency(dep: Path) -> None:
        dep = dep.resolve()
        if dep in copied or is_macos_system_library(dep):
            return
        target = lib_dir / dep.name
        shutil.copy2(dep, target)
        copied[dep] = target
        for child in macos_dependencies(dep):
            copy_dependency(child)

    for dep in macos_dependencies(source_exe):
        copy_dependency(dep)

    for copied_path in copied.values():
        subprocess.run(
            ["install_name_tool", "-id", f"@loader_path/{copied_path.name}", str(copied_path)],
            check=False,
        )
        rewrite_macos_dependencies(copied_path, "@loader_path")

    rewrite_macos_dependencies(target_exe, "@executable_path/lib")
    return target_exe


def macos_dependencies(binary: Path) -> list[Path]:
    result = subprocess.run(
        ["otool", "-L", str(binary)],
        check=True,
        capture_output=True,
        text=True,
    )
    deps: list[Path] = []
    for line in result.stdout.splitlines()[1:]:
        value = line.strip().split(" ", 1)[0]
        if value.startswith("@"):
            continue
        dep = Path(value)
        if dep.exists() and not is_macos_system_library(dep):
            deps.append(dep)
    return deps


def rewrite_macos_dependencies(binary: Path, prefix: str) -> None:
    for dep in macos_dependencies(binary):
        subprocess.run(
            ["install_name_tool", "-change", str(dep), f"{prefix}/{dep.name}", str(binary)],
            check=True,
        )


def is_macos_system_library(path: Path) -> bool:
    value = str(path)
    return value.startswith("/usr/lib/") or value.startswith("/System/Library/")


def copy_tessdata(source_tessdata: Path | None, target_tessdata: Path) -> None:
    if source_tessdata is None:
        return
    for item in source_tessdata.iterdir():
        target = target_tessdata / item.name
        if item.is_dir() and item.name in {"configs", "tessconfigs"}:
            shutil.copytree(item, target, dirs_exist_ok=True)
        elif item.name in REQUIRED_TESSDATA:
            shutil.copy2(item, target)


def ensure_required_tessdata(target_tessdata: Path) -> None:
    for filename in REQUIRED_TESSDATA:
        target = target_tessdata / filename
        if target.exists():
            continue
        url = f"{TESSDATA_FAST_BASE}/{filename}"
        print(f"Downloading missing Tesseract language data: {url}")
        try:
            urllib.request.urlretrieve(url, target)
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Could not download required tessdata {filename}: {exc}") from exc


def verify_packaged_resources(binaries_dir: Path) -> None:
    support_dir = binaries_dir / "_internal"
    for source, destination in REQUIRED_PACKAGED_RESOURCES:
        target = support_dir / destination / source.name
        if not target.exists():
            raise FileNotFoundError(f"Required packaged engine resource missing: {target}")

    model_dir = support_dir / "pl_core_news_lg"
    if not model_dir.exists():
        raise FileNotFoundError(f"Required spaCy model package missing: {model_dir}")


def smoke_test(sidecar_exe: Path, tesseract_exe: Path) -> None:
    smoke_test_process(sidecar_exe, tesseract_exe, cwd=sidecar_exe.parent)


def smoke_test_tauri_resource_layout(
    *,
    binaries_dir: Path,
    staged_exe: Path,
    suffix: str,
) -> None:
    with tempfile.TemporaryDirectory(prefix="anonymizer-tauri-layout-") as temp_dir:
        resource_dir = Path(temp_dir)
        sidecar_exe = resource_dir / f"{SIDECAR_NAME}{suffix}"
        shutil.copy2(staged_exe, sidecar_exe)
        sidecar_exe.chmod(sidecar_exe.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

        shutil.copytree(binaries_dir / "_internal", resource_dir / "_internal")
        resource_binaries_dir = resource_dir / "binaries"
        resource_binaries_dir.mkdir()
        shutil.copytree(binaries_dir / "tesseract", resource_binaries_dir / "tesseract")

        tesseract_name = "tesseract.exe" if suffix == ".exe" else "tesseract"
        smoke_test_process(
            sidecar_exe,
            resource_binaries_dir / "tesseract" / tesseract_name,
            cwd=resource_binaries_dir,
        )


def smoke_test_process(sidecar_exe: Path, tesseract_exe: Path, *, cwd: Path) -> None:
    env = os.environ.copy()
    env["ANONYMIZER_TESSERACT_PATH"] = str(tesseract_exe)
    env["TESSDATA_PREFIX"] = str(tesseract_exe.parent / "tessdata")
    process = subprocess.Popen(
        [str(sidecar_exe), "--mode", "sidecar", "--port", "0"],
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    stderr_lines: list[str] = []
    try:
        stderr_queue = start_stream_reader(process.stderr, stderr_lines)
        stdout_lines: list[str] = []
        stdout_queue = start_stream_reader(process.stdout, stdout_lines)
        startup = read_startup_json(process, stdout_queue, stderr_queue)
        port = int(startup["port"])
        token = str(startup["token"])
        request_json("GET", port, token, "/v1/health")
        analyze = request_json(
            "POST",
            port,
            token,
            "/v1/analyze",
            {"text": "Jan Kowalski ma PESEL 44051401359.", "language": "pl"},
            timeout=180,
        )
        categories = {entity["category"] for entity in analyze["entities"]}
        missing_categories = {"PERSON", "PESEL"} - categories
        if missing_categories:
            raise RuntimeError(
                f"Smoke analyze missed expected categories {sorted(missing_categories)}: "
                f"{analyze}\n{chr(10).join(stderr_lines)}"
            )
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
        if process.returncode not in {0, -15, 1}:
            print("\n".join(stderr_lines), file=sys.stderr)


def start_stream_reader(
    stream: object,
    lines: list[str],
) -> queue.Queue[str]:
    line_queue: queue.Queue[str] = queue.Queue()

    def reader() -> None:
        if stream is None:
            return
        for line in stream:
            value = str(line).rstrip()
            lines.append(value)
            line_queue.put(value)

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    return line_queue


def read_startup_json(
    process: subprocess.Popen[str],
    stdout_queue: queue.Queue[str],
    stderr_queue: queue.Queue[str],
) -> dict[str, object]:
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            line = stdout_queue.get(timeout=0.2)
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
        except queue.Empty:
            pass
        if process.poll() is not None:
            stderr = drain_queue(stderr_queue)
            raise RuntimeError(
                f"Sidecar exited before startup JSON with code {process.returncode}.\n{stderr}"
            )
    raise TimeoutError("Timed out waiting for sidecar startup JSON.")


def request_json(
    method: str,
    port: int,
    token: str,
    path: str,
    payload: dict[str, object] | None = None,
    *,
    timeout: int = 30,
) -> dict[str, object]:
    data = None
    headers = {"X-Api-Key": token}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def drain_queue(items: queue.Queue[str]) -> str:
    lines: list[str] = []
    while True:
        try:
            lines.append(items.get_nowait().rstrip())
        except queue.Empty:
            return "\n".join(lines)


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    return sum(item.stat().st_size for item in walk_files(path))


def walk_files(path: Path) -> Iterable[Path]:
    for item in path.rglob("*"):
        if item.is_file():
            yield item


if __name__ == "__main__":
    main()
