"""Domain exceptions raised by document parsers."""

from __future__ import annotations


class ParserError(Exception):
    """Base class for parser-domain errors."""


class UnsupportedFormat(ParserError):
    """Raised when a file format cannot be dispatched to a parser."""


class CorruptedFile(ParserError):
    """Raised when a supported file cannot be parsed as a valid document."""


class DocumentTooLarge(ParserError):
    """Raised when a supported file exceeds structural safety limits."""


class PasswordProtectedPdf(ParserError):
    """Raised when a PDF requires a password before text can be extracted."""
