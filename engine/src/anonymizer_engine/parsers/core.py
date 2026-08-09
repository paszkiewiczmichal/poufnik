"""Document parsers producing canonical text with stable block offsets."""

from __future__ import annotations

import io
import mimetypes
import re
import zipfile
from pathlib import Path
from typing import Any

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
    data = _read_bytes(source)
    _validate_docx_archive(data)

    try:
        from docx import Document
    except ImportError as exc:  # pragma: no cover - dependency is declared in pyproject
        raise RuntimeError("python-docx is required to parse DOCX files.") from exc

    try:
        document = Document(io.BytesIO(data))
    except Exception as exc:
        raise CorruptedFile("DOCX file is corrupted or not a valid DOCX document.") from exc

    builder = _TextBuilder()
    _append_docx_headers(document, builder)
    _append_docx_container(document, builder)
    _append_docx_footers(document, builder)
    return builder.build("docx", has_text_layer=True, page_count=1)


def parse_pdf(source: Source) -> ParsedDocument:
    data = _read_bytes(source)

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
        if force_ocr:
            from anonymizer_engine.ocr import ocr_pdf

            return ocr_pdf(data)
        parsed = parse_pdf(data)
        if not parsed.has_text_layer:
            from anonymizer_engine.ocr import ocr_pdf

            return ocr_pdf(data)
        return parsed
    if document_format in {"png", "jpg", "heic"}:
        from anonymizer_engine.ocr import build_ocr_image_document

        return build_ocr_image_document(data, document_format)

    raise UnsupportedFormat(f"Unsupported document format: {document_format!r}")


def _append_docx_headers(document: Any, builder: _TextBuilder) -> None:
    _append_docx_section_stories(
        document,
        builder,
        ("header", "first_page_header", "even_page_header"),
    )


def _append_docx_footers(document: Any, builder: _TextBuilder) -> None:
    _append_docx_section_stories(
        document,
        builder,
        ("footer", "first_page_footer", "even_page_footer"),
    )


def _append_docx_section_stories(
    document: Any,
    builder: _TextBuilder,
    story_names: tuple[str, ...],
) -> None:
    seen_story_ids: set[int] = set()
    for section in document.sections:
        for story_name in story_names:
            story = getattr(section, story_name)
            if story.is_linked_to_previous:
                continue
            story_id = id(story._element)
            if story_id in seen_story_ids:
                continue
            seen_story_ids.add(story_id)
            _append_docx_container(story, builder)


def _append_docx_container(container: Any, builder: _TextBuilder) -> None:
    for item in container.iter_inner_content():
        if hasattr(item, "rows"):
            _append_docx_table(item, builder)
            continue
        text = _clean_text(item.text)
        if not text:
            continue
        builder.append_block(text, _docx_paragraph_kind(item), None)


def _append_docx_table(table: Any, builder: _TextBuilder) -> None:
    table_started = False
    for row in table.rows:
        cells = [(_clean_text(cell.text), cell) for cell in row.cells]
        if not any(text for text, _cell in cells):
            continue
        if not table_started:
            if builder.length > 0:
                builder.append_raw("\n\n")
            table_started = True
        else:
            builder.append_raw("\n")

        for cell_index, (cell_text, _cell) in enumerate(cells):
            if cell_index > 0:
                builder.append_raw("\t")
            if cell_text:
                builder.append_table_cell(cell_text)


def _docx_paragraph_kind(paragraph: Any) -> BlockKind:
    style = getattr(paragraph, "style", None)
    style_name = (getattr(style, "name", "") or "").casefold()
    if style_name == "title" or style_name.startswith("heading"):
        return "heading"
    return "paragraph"


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
                "DOCX archive member exceeds the maximum uncompressed size "
                f"({member.filename})."
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
