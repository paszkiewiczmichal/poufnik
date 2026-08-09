"""Document parser primitives."""

from anonymizer_engine.parsers.core import parse_document, parse_docx, parse_pdf, parse_txt
from anonymizer_engine.parsers.exceptions import (
    CorruptedFile,
    ParserError,
    PasswordProtectedPdf,
    UnsupportedFormat,
)
from anonymizer_engine.parsers.models import Block, ParsedDocument

__all__ = [
    "Block",
    "CorruptedFile",
    "ParsedDocument",
    "ParserError",
    "PasswordProtectedPdf",
    "UnsupportedFormat",
    "parse_docx",
    "parse_document",
    "parse_pdf",
    "parse_txt",
]
