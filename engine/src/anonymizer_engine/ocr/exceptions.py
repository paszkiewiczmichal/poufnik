"""Domain exceptions raised by OCR primitives."""

from __future__ import annotations


class OcrError(Exception):
    """Base class for OCR-domain errors."""


class TesseractNotFound(OcrError):
    """Raised when the configured Tesseract executable cannot be found."""


class OcrExecutionError(OcrError):
    """Raised when Tesseract or PDF rasterization fails during OCR."""
