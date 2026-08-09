"""Offline OCR through Tesseract and PDFium rasterization."""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import warnings
from typing import TYPE_CHECKING

from anonymizer_engine.ocr.exceptions import OcrExecutionError, TesseractNotFound
from anonymizer_engine.parsers.core import MAX_PDF_PAGES
from anonymizer_engine.parsers.exceptions import DocumentTooLarge
from anonymizer_engine.parsers.models import Block, DocumentFormat, ParsedDocument

if TYPE_CHECKING:
    from PIL.Image import Image

_TESSERACT_PATH_ENV = "ANONYMIZER_TESSERACT_PATH"
_DEFAULT_LANGUAGES = "pol+eng"
_PDF_DPI = 300
# Upper bound on the rasterized bitmap size per PDF page. A hostile PDF can declare a huge
# MediaBox; at 300 DPI that would allocate multi-gigabyte bitmaps and OOM the process. We
# cap the output at ~16 megapixels/page and dynamically lower the effective DPI for oversized
# pages instead of trusting the declared page geometry.
MAX_OCR_PAGE_PIXELS = 4000 * 4000

_heif_registered = False


def _register_heif_support() -> None:
    """Register the pillow-heif opener so PIL can decode HEIC/HEIF images (idempotent)."""
    global _heif_registered
    if _heif_registered:
        return
    try:
        from pillow_heif import register_heif_opener
    except ImportError as exc:  # pragma: no cover - dependency is declared in pyproject
        raise RuntimeError("pillow-heif is required to read HEIC/HEIF images.") from exc
    register_heif_opener()
    _heif_registered = True


def _render_scale_for_page(width_pt: float, height_pt: float, base_scale: float) -> float:
    """Clamp the render scale so a single page never exceeds ``MAX_OCR_PAGE_PIXELS``."""
    if width_pt <= 0 or height_pt <= 0:
        return base_scale
    projected_pixels = (width_pt * base_scale) * (height_pt * base_scale)
    if projected_pixels <= MAX_OCR_PAGE_PIXELS:
        return base_scale
    return (MAX_OCR_PAGE_PIXELS / (width_pt * height_pt)) ** 0.5


def _ensure_image_within_limits(pil_image: Image) -> None:
    """Reject images whose pixel count exceeds ``MAX_OCR_PAGE_PIXELS`` before decoding."""
    width, height = pil_image.size
    if width * height > MAX_OCR_PAGE_PIXELS:
        raise OcrExecutionError(
            f"Image dimensions {width}x{height} exceed the OCR safety limit "
            f"({MAX_OCR_PAGE_PIXELS} pixels)."
        )


def ocr_image(image: bytes | Image, languages: str = _DEFAULT_LANGUAGES) -> str:
    """Return OCR text for an image using Tesseract.

    The image is sent to the offline system Tesseract 5 binary over stdin and OCR text is
    read from stdout, so the service does not create document-content temporary files.
    Preprocessing is deliberately minimal: grayscale conversion only; deskew and denoise are
    future accuracy improvements.
    """
    try:
        from PIL import Image as PilImage
    except ImportError as exc:  # pragma: no cover - dependencies are declared in pyproject
        raise RuntimeError("Pillow is required for OCR.") from exc

    _register_heif_support()
    tesseract_cmd = _resolve_tesseract_cmd()

    # Treat PIL's decompression-bomb warning as an error and pin an explicit pixel ceiling
    # so a small, highly compressed file cannot decode into a huge in-memory bitmap.
    PilImage.MAX_IMAGE_PIXELS = MAX_OCR_PAGE_PIXELS
    warnings.simplefilter("error", PilImage.DecompressionBombWarning)

    if isinstance(image, bytes):
        try:
            pil_image = PilImage.open(io.BytesIO(image))
            _ensure_image_within_limits(pil_image)
            pil_image.load()
        except OcrExecutionError:
            raise
        except Exception as exc:
            raise OcrExecutionError("Image bytes are not a readable image file.") from exc
    else:
        pil_image = image
        _ensure_image_within_limits(pil_image)

    grayscale = pil_image.convert("L")
    png_buffer = io.BytesIO()
    grayscale.save(png_buffer, format="PNG")
    command = [
        tesseract_cmd,
        "stdin",
        "stdout",
        "-l",
        languages,
        "--psm",
        "6",
    ]
    try:
        result = subprocess.run(
            command,
            input=png_buffer.getvalue(),
            capture_output=True,
            check=False,
            timeout=120,
        )
    except FileNotFoundError as exc:
        raise _tesseract_not_found(tesseract_cmd) from exc
    except subprocess.TimeoutExpired as exc:
        raise OcrExecutionError("Tesseract OCR timed out.") from exc

    if result.returncode != 0:
        error = result.stderr.decode("utf-8", errors="replace").strip()
        detail = f": {error}" if error else "."
        raise OcrExecutionError(f"Tesseract OCR failed{detail}")

    text = result.stdout.decode("utf-8", errors="replace")
    return _normalize_ocr_text(text)


def ocr_pdf(pdf_bytes: bytes, languages: str = _DEFAULT_LANGUAGES) -> ParsedDocument:
    """Rasterize PDF pages at 300 DPI with pypdfium2 and OCR them sequentially."""
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:  # pragma: no cover - dependency is declared in pyproject
        raise RuntimeError("pypdfium2 is required for PDF OCR.") from exc

    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
    except Exception as exc:
        raise OcrExecutionError("PDF file could not be loaded for OCR rasterization.") from exc

    builder = _OcrDocumentBuilder()
    scale = _PDF_DPI / 72

    try:
        page_count = len(pdf)
        if page_count > MAX_PDF_PAGES:
            raise DocumentTooLarge(
                f"PDF page count exceeds the safety limit ({page_count} > {MAX_PDF_PAGES})."
            )
        for page_index in range(page_count):
            if page_index > 0:
                builder.append_page_break()

            page = pdf[page_index]
            try:
                width_pt, height_pt = page.get_size()
                render_scale = _render_scale_for_page(width_pt, height_pt, scale)
                bitmap = page.render(scale=render_scale)
                try:
                    page_image = bitmap.to_pil().copy()
                finally:
                    bitmap.close()
            finally:
                page.close()

            # PDFium is not thread-safe; keep this sequential for now. A future process pool
            # can parallelize pages without sharing PDFium state across threads.
            page_text = ocr_image(page_image, languages=languages)
            builder.append_page_text(page_text, page=page_index + 1)
    except (DocumentTooLarge, OcrExecutionError, TesseractNotFound):
        raise
    except Exception as exc:
        raise OcrExecutionError("PDF OCR failed while rendering or recognizing a page.") from exc
    finally:
        pdf.close()

    return builder.build(page_count=page_count)


class _OcrDocumentBuilder:
    def __init__(self) -> None:
        self.parts: list[str] = []
        self.blocks: list[Block] = []
        self.length = 0
        self._last_char = ""

    def append_raw(self, value: str) -> None:
        if not value:
            return
        self.parts.append(value)
        self.length += len(value)
        self._last_char = value[-1]

    def append_page_break(self) -> None:
        if self.length > 0 and self._last_char != "\n":
            self.append_raw("\n")
        start = self.length
        self.append_raw("\f")
        self.blocks.append(Block(start=start, end=self.length, kind="page_break", page=None))

    def append_page_text(self, text: str, page: int) -> None:
        if not text:
            return
        if self.length > 0:
            self.append_raw("\n\n")
        start = self.length
        self.append_raw(text)
        self.blocks.append(Block(start=start, end=self.length, kind="paragraph", page=page))

    def build(self, page_count: int) -> ParsedDocument:
        return ParsedDocument(
            text="".join(self.parts),
            blocks=self.blocks,
            format="pdf",
            has_text_layer=False,
            page_count=page_count,
            source="ocr",
        )


def build_ocr_image_document(
    image_bytes: bytes,
    document_format: DocumentFormat,
    languages: str = _DEFAULT_LANGUAGES,
) -> ParsedDocument:
    text = ocr_image(image_bytes, languages=languages)
    blocks = [Block(start=0, end=len(text), kind="paragraph", page=1)] if text else []
    return ParsedDocument(
        text=text,
        blocks=blocks,
        format=document_format,
        has_text_layer=False,
        page_count=1,
        source="ocr",
    )


def _resolve_tesseract_cmd() -> str:
    configured = os.environ.get(_TESSERACT_PATH_ENV)
    if configured:
        resolved = shutil.which(configured)
        if resolved:
            return resolved
        if os.path.isfile(configured):
            return configured
        raise _tesseract_not_found(configured)

    resolved = shutil.which("tesseract")
    if resolved:
        return resolved
    raise _tesseract_not_found(None)


def _tesseract_not_found(path: str | None) -> TesseractNotFound:
    configured_hint = f" Configured path was: {path!r}." if path else ""
    return TesseractNotFound(
        "Tesseract executable was not found."
        f"{configured_hint} Install Tesseract 5 with Polish and English language data "
        "(Ubuntu: sudo apt-get install tesseract-ocr tesseract-ocr-pol tesseract-ocr-eng; "
        "macOS: brew install tesseract tesseract-lang; "
        "Windows/Chocolatey: choco install tesseract), or set "
        "ANONYMIZER_TESSERACT_PATH to the tesseract executable."
    )


def _normalize_ocr_text(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()
