"""WordprocessingML (DOCX) reading and in-place anonymization."""

from anonymizer_engine.wordml.redact import (
    DocxExportError,
    InPlaceResult,
    anonymize_docx_in_place,
    load,
)

__all__ = ["DocxExportError", "InPlaceResult", "anonymize_docx_in_place", "load"]
