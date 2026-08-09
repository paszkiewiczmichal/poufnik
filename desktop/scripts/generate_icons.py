"""Generate Tauri app icons from the Poufnik design-system icon."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
SOURCE_ICON = REPO_ROOT / "dokumentacja" / "Poufnik Design System" / "assets" / "icon.webp"
ICON_DIR = ROOT / "src-tauri" / "icons"
SIZES = [32, 64, 128, 256, 512, 1024]


def main() -> None:
    source = load_source_icon(SOURCE_ICON)
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    images = {size: source.resize((size, size), Image.Resampling.LANCZOS) for size in SIZES}

    images[32].save(ICON_DIR / "32x32.png")
    images[128].save(ICON_DIR / "128x128.png")
    images[256].save(ICON_DIR / "128x128@2x.png")
    images[512].save(ICON_DIR / "icon.png")
    images[256].save(ICON_DIR / "icon.ico", sizes=[(32, 32), (64, 64), (128, 128), (256, 256)])
    images[1024].save(ICON_DIR / "icon.icns")


def load_source_icon(path: Path) -> Image.Image:
    if not path.exists():
        raise FileNotFoundError(f"Poufnik design-system icon not found: {path}")

    image = Image.open(path).convert("RGBA")
    width, height = image.size
    if width == height:
        return image

    side = max(width, height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(image, ((side - width) // 2, (side - height) // 2))
    return canvas


if __name__ == "__main__":
    main()
