"""Document parsers producing canonical text with stable block offsets."""

from __future__ import annotations

import io
import mimetypes
import re
import zipfile
from pathlib import Path

from anonymizer_engine.parsers.exceptions import (
    CorruptedFile,
    DocumentTooLarge,
    PasswordProtectedPdf,
    UnsupportedFormat,
)
from anonymizer_engine.parsers.models import Block, BlockKind, DocumentFormat, ParsedDocument

Source = str | Path | bytes

_EXTENSION_FORMATS: dict[str, DocumentFormat] = {
    ".txt": "txt",
    ".text": "txt",
    ".docx": "docx",
    ".pdf": "pdf",
    ".png": "png",
    ".jpg": "jpg",
    ".jpeg": "jpg",
    ".jpe": "jpg",
    ".heic": "heic",
    ".heif": "heic",
}
_MIME_FORMATS: dict[str, DocumentFormat] = {
    "text/plain": "txt",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/heif": "heic",
}
# Marki HEIF w boksie ftyp (ISO BMFF, bajty 8-12) uznawane za obrazy HEIC/HEIF.
_HEIF_FTYP_BRANDS = {b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1"}
_MIN_TEXT_LAYER_CHARS_PER_PAGE = 32
MAX_DOCX_ARCHIVE_FILES = 4096
MAX_DOCX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
MAX_DOCX_MEMBER_BYTES = 100 * 1024 * 1024
MAX_DOCX_COMPRESSION_RATIO = 200
MAX_PDF_PAGES = 1000
# Notice: the PDF was imported, but its glyphs could not be mapped for an in-place export.
PDF_LAYOUT_UNAVAILABLE = "pdf_layout_export_unavailable"


class _TextBuilder:
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

    def append_block(
        self,
        content: str,
        kind: BlockKind,
        page: int | None = None,
        *,
        separate: bool = True,
    ) -> None:
        if not content:
            return
        if separate and self.length > 0:
            self.append_raw("\n\n")
        start = self.length
        self.append_raw(content)
        self.blocks.append(Block(start=start, end=self.length, kind=kind, page=page))

    def append_table_cell(self, content: str, page: int | None = None) -> None:
        self.append_block(content, "table_cell", page, separate=False)

    def append_page_break(self) -> None:
        if self.length > 0 and self._last_char != "\n":
            self.append_raw("\n")
        self.append_block("\f", "page_break", None, separate=False)

    def build(
        self,
        document_format: DocumentFormat,
        *,
        has_text_layer: bool,
        page_count: int,
    ) -> ParsedDocument:
        return ParsedDocument(
            text="".join(self.parts),
            blocks=self.blocks,
            format=document_format,
            has_text_layer=has_text_layer,
            page_count=page_count,
        )


def parse_txt(source: Source) -> ParsedDocument:
    data = _read_bytes(source)
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = data.decode("cp1250")
        except UnicodeDecodeError as exc:
            raise CorruptedFile("TXT file is neither UTF-8 nor CP1250 encoded.") from exc

    text = _normalize_newlines(text)
    builder = _TextBuilder()
    builder.append_raw(text)
    for start, end in _paragraph_ranges(text):
        builder.blocks.append(Block(start=start, end=end, kind="paragraph", page=None))
    return builder.build("txt", has_text_layer=True, page_count=1)


def parse_docx(source: Source) -> ParsedDocument:
    """Parse DOCX text straight from its XML (see :mod:`anonymizer_engine.wordml`).

    The document is sanitized in memory first (tracked changes accepted, comments and
    personal metadata removed), so the parsed text is exactly what an in-place export
    of the same file will contain.
    """
    data = _read_bytes(source)
    _validate_docx_archive(data)

    from anonymizer_engine.wordml import load

    _package, text_map, notices = load(data)
    return ParsedDocument(
        text=text_map.text,
        blocks=text_map.blocks,
        format="docx",
        has_text_layer=True,
        page_count=1,
        notices=notices,
    )


def parse_pdf(source: Source) -> ParsedDocument:
    """Parse PDF text together with a glyph map (see :mod:`anonymizer_engine.pdfredact`).

    The document is sanitized in memory first (form fields flattened, annotations and
    metadata removed), so the text is exactly what an in-place export redacts. A PDF whose
    glyphs cannot be mapped reliably is still imported, without in-place export.
    """
    data = _read_bytes(source)
    from anonymizer_engine.pdfredact import PdfExportError, load

    try:
        loaded = load(data, max_pages=MAX_PDF_PAGES)
    except (ValueError, PdfExportError, CorruptedFile):
        # Still import what the plain reader can read (it raises its own errors otherwise).
        parsed = _parse_pdf_plain(data)
        parsed.notices.append(PDF_LAYOUT_UNAVAILABLE)
        return parsed
    text_map = loaded.text_map
    page_count = len(text_map.pages)
    threshold = _MIN_TEXT_LAYER_CHARS_PER_PAGE * page_count
    has_text_layer = page_count == 0 or text_map.extracted_chars >= threshold
    return ParsedDocument(
        text=text_map.text,
        blocks=text_map.blocks,
        format="pdf",
        has_text_layer=has_text_layer,
        page_count=page_count,
        notices=loaded.notices,
    )


def _parse_pdf_plain(data: bytes) -> ParsedDocument:
    try:
        import pdfplumber
    except ImportError as exc:  # pragma: no cover - dependency is declared in pyproject
        raise RuntimeError("pdfplumber is required to parse PDF files.") from exc

    builder = _TextBuilder()
    extracted_chars = 0

    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            page_count = len(pdf.pages)
            _ensure_pdf_page_limit(page_count)
            for page_index, page in enumerate(pdf.pages, start=1):
                if page_index > 1:
                    builder.append_page_break()
                page_text = _normalize_newlines(page.extract_text() or "")
                extracted_chars += len(page_text.strip())
                for paragraph in _split_pdf_paragraphs(page_text):
                    builder.append_block(paragraph, "paragraph", page_index)
    except Exception as exc:
        _raise_pdf_error(exc)

    threshold = _MIN_TEXT_LAYER_CHARS_PER_PAGE * page_count
    has_text_layer = page_count == 0 or extracted_chars >= threshold
    return builder.build("pdf", has_text_layer=has_text_layer, page_count=page_count)


def parse_document(
    source: Source,
    filename: str | None = None,
    *,
    force_ocr: bool = False,
) -> ParsedDocument:
    data, effective_filename = _read_document_source(source, filename)
    document_format = _detect_document_format(data, effective_filename)

    if document_format == "txt":
        return parse_txt(data)
    if document_format == "docx":
        return parse_docx(data)
    if document_format == "pdf":
        if not force_ocr:
            parsed = parse_pdf(data)
            if parsed.has_text_layer:
                return parsed
        # OCR reads the sanitized PDF - the same bytes an in-place export recognizes again.
        from anonymizer_engine.ocr import ocr_pdf
        from anonymizer_engine.pdfredact.scan import sanitized_pdf

        try:
            sanitized, notices = sanitized_pdf(data)
        except Exception:
            sanitized, notices = data, []
        parsed = ocr_pdf(sanitized)
        parsed.notices.extend(notices)
        return parsed
    if document_format in {"png", "jpg", "heic"}:
        from anonymizer_engine.ocr import build_ocr_image_document

        return build_ocr_image_document(data, document_format)

    raise UnsupportedFormat(f"Unsupported document format: {document_format!r}")


def _clean_text(text: str) -> str:
    return _normalize_newlines(text).strip()


def _normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _split_pdf_paragraphs(text: str) -> list[str]:
    return [paragraph.strip() for paragraph in re.split(r"\n\s*\n+", text) if paragraph.strip()]


def _paragraph_ranges(text: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    paragraph_start: int | None = None
    paragraph_end = 0
    offset = 0

    for line in text.splitlines(keepends=True):
        line_start = offset
        line_end = offset + len(line)
        if line.strip():
            if paragraph_start is None:
                paragraph_start = line_start
            paragraph_end = _line_without_newline_end(text, line_end)
        elif paragraph_start is not None:
            ranges.append((paragraph_start, paragraph_end))
            paragraph_start = None
        offset = line_end

    if paragraph_start is not None:
        ranges.append((paragraph_start, paragraph_end))

    return ranges


def _line_without_newline_end(text: str, line_end: int) -> int:
    if line_end > 0 and text[line_end - 1] == "\n":
        return line_end - 1
    return line_end


def _read_document_source(source: Source, filename: str | None) -> tuple[bytes, str | None]:
    if isinstance(source, bytes):
        return source, filename
    path = Path(source)
    return path.read_bytes(), filename or path.name


def _read_bytes(source: Source) -> bytes:
    if isinstance(source, bytes):
        return source
    return Path(source).read_bytes()


def _detect_document_format(data: bytes, filename: str | None) -> DocumentFormat:
    if filename:
        suffix = Path(filename).suffix.casefold()
        if suffix in _EXTENSION_FORMATS:
            return _EXTENSION_FORMATS[suffix]
        if suffix:
            raise UnsupportedFormat(f"Unsupported document extension: {suffix}")

        mime_type, _encoding = mimetypes.guess_type(filename)
        if mime_type in _MIME_FORMATS:
            return _MIME_FORMATS[mime_type]

    if data.startswith(b"%PDF"):
        return "pdf"
    if data.startswith(b"PK"):
        return "docx"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12] in _HEIF_FTYP_BRANDS:
        return "heic"
    if filename is None or not Path(filename).suffix:
        return "txt"

    raise UnsupportedFormat("Unsupported document format.")


def _validate_docx_archive(data: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = archive.infolist()
    except zipfile.BadZipFile as exc:
        raise CorruptedFile("DOCX file is not a valid ZIP archive.") from exc

    if len(members) > MAX_DOCX_ARCHIVE_FILES:
        raise DocumentTooLarge(
            f"DOCX archive contains too many files ({len(members)} > {MAX_DOCX_ARCHIVE_FILES})."
        )

    total_uncompressed = 0
    for member in members:
        total_uncompressed += member.file_size
        if member.file_size > MAX_DOCX_MEMBER_BYTES:
            raise DocumentTooLarge(
                f"DOCX archive member exceeds the maximum uncompressed size ({member.filename})."
            )
        if member.compress_size > 0:
            ratio = member.file_size / member.compress_size
            if ratio > MAX_DOCX_COMPRESSION_RATIO:
                raise DocumentTooLarge(
                    "DOCX archive compression ratio is too high "
                    f"({member.filename}, ratio {ratio:.1f})."
                )

    if total_uncompressed > MAX_DOCX_UNCOMPRESSED_BYTES:
        raise DocumentTooLarge(
            "DOCX archive uncompressed size exceeds the safety limit "
            f"({total_uncompressed} > {MAX_DOCX_UNCOMPRESSED_BYTES})."
        )


def _ensure_pdf_page_limit(page_count: int) -> None:
    if page_count > MAX_PDF_PAGES:
        raise DocumentTooLarge(
            f"PDF page count exceeds the safety limit ({page_count} > {MAX_PDF_PAGES})."
        )


def _raise_pdf_error(exc: Exception) -> None:
    if isinstance(exc, DocumentTooLarge):
        raise exc
    exception_name = exc.__class__.__name__.casefold()
    message = str(exc).casefold()
    if "password" in exception_name or "password" in message or "encrypted" in message:
        raise PasswordProtectedPdf("PDF file is password-protected.") from exc
    raise CorruptedFile("PDF file is corrupted or not a valid PDF document.") from exc
