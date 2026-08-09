from __future__ import annotations

import io
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

from anonymizer_engine.detection import EntityCategory, ValidationStatus, detect_all
from anonymizer_engine.detection.models import DetectedEntity
from anonymizer_engine.ocr import TesseractNotFound, ocr_image, ocr_pdf
from anonymizer_engine.parsers import ParsedDocument, parse_document

_OCR_TEXT = "Jan Kowalski\nPESEL 44051401359\nZażółć gęślą jaźń"


def _tesseract_supports(languages: str) -> bool:
    command = os.environ.get("ANONYMIZER_TESSERACT_PATH") or shutil.which("tesseract")
    if command is None:
        return False
    try:
        result = subprocess.run(
            [command, "--list-langs"],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    if result.returncode != 0:
        return False
    available = {
        line.strip()
        for line in (result.stdout + "\n" + result.stderr).splitlines()
        if line.strip() and not line.startswith("List of available languages")
    }
    return set(languages.split("+")).issubset(available)


_REQUIRES_TESSERACT = pytest.mark.skipif(
    not _tesseract_supports("pol+eng"),
    reason=(
        "Tesseract with pol+eng language data is required for full OCR tests; "
        "CI installs tesseract-ocr and tesseract-ocr-pol."
    ),
)


@dataclass(frozen=True)
class Token:
    text: str
    idx: int
    lemma_: str


class NameNerEngine:
    def __init__(self) -> None:
        self.last_tokens: list[Token] = []

    def analyze(self, text: str, language: str) -> list[DetectedEntity]:
        assert language == "pl"
        match = re.search(r"Jan\s+Kowalski|Kowalski", text)
        if match is None:
            return []
        return [
            DetectedEntity(
                category=EntityCategory.PERSON,
                start=match.start(),
                end=match.end(),
                text=match.group(),
                confidence=0.9,
                source="ner",
                validation=ValidationStatus.NOT_APPLICABLE,
            )
        ]


@_REQUIRES_TESSERACT
@pytest.mark.ocr
def test_ocr_image_preserves_entities_for_detection() -> None:
    image_bytes = _render_ocr_image_bytes(_OCR_TEXT)

    text = ocr_image(image_bytes)
    result = detect_all(text, ner_engine=NameNerEngine())

    assert "44051401359" in text
    assert "Kowalski" in text
    categories = {entity.category for entity in result.entities}
    assert EntityCategory.PESEL in categories
    assert EntityCategory.PERSON in categories


@_REQUIRES_TESSERACT
@pytest.mark.ocr
def test_ocr_pdf_returns_ocr_parsed_document_and_detectable_entities(tmp_path: Path) -> None:
    image_bytes = _render_ocr_image_bytes(_OCR_TEXT)
    pdf_path = tmp_path / "scan.pdf"
    _write_image_pdf(pdf_path, image_bytes)

    parsed = ocr_pdf(pdf_path.read_bytes())
    result = detect_all(parsed.text, ner_engine=NameNerEngine())

    assert parsed.format == "pdf"
    assert parsed.source == "ocr"
    assert parsed.has_text_layer is False
    assert parsed.page_count == 1
    assert "44051401359" in parsed.text
    assert "Kowalski" in parsed.text
    assert parsed.blocks
    assert parsed.text[parsed.blocks[0].start : parsed.blocks[0].end] == parsed.text
    categories = {entity.category for entity in result.entities}
    assert EntityCategory.PESEL in categories
    assert EntityCategory.PERSON in categories


def test_parse_document_text_pdf_does_not_call_ocr(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pdf_path = tmp_path / "text.pdf"
    _write_text_pdf(pdf_path, "Jan Kowalski PESEL 44051401359 " * 3)

    def fail_ocr(_pdf_bytes: bytes) -> ParsedDocument:
        raise AssertionError("Text-layer PDF should not be routed through OCR")

    import anonymizer_engine.ocr as ocr_module

    monkeypatch.setattr(ocr_module, "ocr_pdf", fail_ocr)

    parsed = parse_document(pdf_path)

    assert parsed.source == "parsed"
    assert parsed.has_text_layer is True
    assert "44051401359" in parsed.text


def test_parse_document_force_ocr_routes_pdf_to_ocr(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pdf_path = tmp_path / "text.pdf"
    _write_text_pdf(pdf_path, "Jan Kowalski PESEL 44051401359 " * 3)
    calls: list[bytes] = []

    def spy_ocr(pdf_bytes: bytes) -> ParsedDocument:
        calls.append(pdf_bytes)
        return ParsedDocument(
            text="OCR text",
            blocks=[],
            format="pdf",
            has_text_layer=False,
            page_count=1,
            source="ocr",
        )

    import anonymizer_engine.ocr as ocr_module

    monkeypatch.setattr(ocr_module, "ocr_pdf", spy_ocr)

    parsed = parse_document(pdf_path, force_ocr=True)

    assert parsed.source == "ocr"
    assert parsed.text == "OCR text"
    assert calls == [pdf_path.read_bytes()]


def test_parse_document_image_routes_to_ocr(monkeypatch: pytest.MonkeyPatch) -> None:
    image_bytes = _render_ocr_image_bytes("Jan Kowalski")
    calls: list[tuple[bytes, str]] = []

    def spy_image_document(image_data: bytes, document_format: str) -> ParsedDocument:
        calls.append((image_data, document_format))
        return ParsedDocument(
            text="Jan Kowalski",
            blocks=[],
            format=document_format,
            has_text_layer=False,
            page_count=1,
            source="ocr",
        )

    import anonymizer_engine.ocr as ocr_module

    monkeypatch.setattr(ocr_module, "build_ocr_image_document", spy_image_document)

    parsed = parse_document(image_bytes, filename="scan.png")

    assert parsed.source == "ocr"
    assert parsed.format == "png"
    assert calls == [(image_bytes, "png")]


def test_parse_document_heic_routes_to_ocr(monkeypatch: pytest.MonkeyPatch) -> None:
    heic_bytes = _render_ocr_heic_bytes("Jan Kowalski")
    calls: list[tuple[bytes, str]] = []

    def spy_image_document(image_data: bytes, document_format: str) -> ParsedDocument:
        calls.append((image_data, document_format))
        return ParsedDocument(
            text="Jan Kowalski",
            blocks=[],
            format=document_format,
            has_text_layer=False,
            page_count=1,
            source="ocr",
        )

    import anonymizer_engine.ocr as ocr_module

    monkeypatch.setattr(ocr_module, "build_ocr_image_document", spy_image_document)

    for filename in ("skan.heic", "skan.HEIF", None):
        parsed = parse_document(heic_bytes, filename=filename)
        assert parsed.source == "ocr"
        assert parsed.format == "heic"

    assert calls == [(heic_bytes, "heic")] * 3


@_REQUIRES_TESSERACT
@pytest.mark.ocr
def test_parse_document_heic_full_pipeline_detects_entities() -> None:
    heic_bytes = _render_ocr_heic_bytes(_OCR_TEXT)

    parsed = parse_document(heic_bytes, filename="skan.heic")
    result = detect_all(parsed.text, ner_engine=NameNerEngine())

    assert parsed.format == "heic"
    assert parsed.source == "ocr"
    assert parsed.has_text_layer is False
    assert parsed.page_count == 1
    assert "44051401359" in parsed.text
    assert "Kowalski" in parsed.text
    categories = {entity.category for entity in result.entities}
    assert EntityCategory.PESEL in categories
    assert EntityCategory.PERSON in categories


def test_ocr_image_raises_clear_error_when_tesseract_path_is_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    image_bytes = _render_ocr_image_bytes("Jan Kowalski")
    monkeypatch.setenv("ANONYMIZER_TESSERACT_PATH", "__missing_tesseract_binary__")

    with pytest.raises(TesseractNotFound) as exc_info:
        ocr_image(image_bytes)

    message = str(exc_info.value)
    assert "Tesseract executable was not found" in message
    assert "ANONYMIZER_TESSERACT_PATH" in message
    assert "tesseract-ocr-pol" in message


def _render_ocr_image_bytes(text: str) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    font_path = _find_font_path()
    if font_path is None:
        pytest.skip("No local TrueType font with Polish diacritics was found for OCR fixture.")

    font = ImageFont.truetype(str(font_path), size=64)
    spacing = 22
    probe = Image.new("RGB", (1, 1), "white")
    draw = ImageDraw.Draw(probe)
    left, top, right, bottom = draw.multiline_textbbox((0, 0), text, font=font, spacing=spacing)
    width = right - left + 180
    height = bottom - top + 180

    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.multiline_text((90, 90), text, fill="black", font=font, spacing=spacing)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", dpi=(300, 300))
    return buffer.getvalue()


def _render_ocr_heic_bytes(text: str) -> bytes:
    from PIL import Image
    from pillow_heif import register_heif_opener

    register_heif_opener()
    png_bytes = _render_ocr_image_bytes(text)
    image = Image.open(io.BytesIO(png_bytes))
    buffer = io.BytesIO()
    image.save(buffer, format="HEIF", quality=90)
    data = buffer.getvalue()
    assert data[4:8] == b"ftyp"
    return data


def _find_font_path() -> Path | None:
    candidates = [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
        Path("/Library/Fonts/Arial Unicode.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/calibri.ttf"),
    ]
    return next((path for path in candidates if path.exists()), None)


def _write_text_pdf(path: Path, text: str) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    font_path = _find_font_path()
    font_name = "Helvetica"
    if font_path is not None:
        font_name = "AnonymizerOcrTestFont"
        if font_name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(font_name, str(font_path)))

    _width, height = A4
    pdf = canvas.Canvas(str(path), pagesize=A4)
    pdf.setFont(font_name, 14)
    pdf.drawString(72, height - 72, text)
    pdf.save()


def _write_image_pdf(path: Path, image_bytes: bytes) -> None:
    from PIL import Image
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    image = Image.open(io.BytesIO(image_bytes))
    image_reader = ImageReader(image)
    width, height = A4
    target_width = width - 96
    target_height = target_width * image.height / image.width
    pdf = canvas.Canvas(str(path), pagesize=A4)
    pdf.drawImage(
        image_reader,
        48,
        height - target_height - 72,
        width=target_width,
        height=target_height,
    )
    pdf.save()
