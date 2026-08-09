"""Offline OCR primitives."""

from anonymizer_engine.ocr.core import build_ocr_image_document, ocr_image, ocr_pdf
from anonymizer_engine.ocr.exceptions import OcrError, OcrExecutionError, TesseractNotFound

__all__ = [
    "OcrError",
    "OcrExecutionError",
    "TesseractNotFound",
    "build_ocr_image_document",
    "ocr_image",
    "ocr_pdf",
]
