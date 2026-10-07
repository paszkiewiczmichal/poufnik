"""Paint anonymized values over pictures inside a text PDF (screenshots, scanned inserts).

Every image drawn on a page is recognized with OCR. A recognized word that is a word of an
anonymized value - compared without case and Polish diacritics, because OCR of a screenshot
reads "ŁAPIŃSKA" as "LAPINSKA" - is painted over in the pixels, and the image object is
rewritten in place, so it keeps its position and size on the page.

Names that appear only in a picture, and never in the document text, are not known to be
sensitive; the existing notice still asks the user to check images.
"""

from __future__ import annotations

import io
import re
import unicodedata

import pikepdf
from pikepdf import Name, PdfImage

from anonymizer_engine.pdfredact.redact import PdfExportError, SensitiveValues

_MIN_WORD_LENGTH = 3
_MIN_IMAGE_SIDE = 24
_REDACTION_FILL = (235, 235, 235)
_WORD_RE = re.compile(r"[^\W_]+")


def paint_values_in_images(
    pdf: pikepdf.Pdf, values: SensitiveValues, skip_pages: set[int]
) -> list[pikepdf.Object]:
    """Paint value words in every image of ``pdf``; return the images that were changed."""
    words = value_words(values)
    if not words:
        return []
    changed: list[pikepdf.Object] = []
    seen: set[tuple[int, int]] = set()
    for page_index, page in enumerate(pdf.pages):
        if page_index in skip_pages:
            continue
        for raw in page.images.values():
            key = raw.objgen
            if key != (0, 0):
                if key in seen:
                    continue
                seen.add(key)
            if _paint_image(pdf, raw, words):
                changed.append(raw)
    return changed


def verify_images(images: list[pikepdf.Object], values: SensitiveValues) -> None:
    """OCR the rewritten images again: no word of an anonymized value may be readable."""
    from anonymizer_engine.ocr.core import ocr_image_words

    words = value_words(values)
    for raw in images:
        recognized = ocr_image_words(PdfImage(raw).as_pil_image())
        if any(normalize_word(word.text) in words for word in recognized.words):
            raise PdfExportError(
                "Verification failed: an anonymized value is still readable in an image."
            )


def value_words(values: SensitiveValues) -> set[str]:
    return {
        normalized
        for value in values.values
        for word in _WORD_RE.findall(value)
        if len(normalized := normalize_word(word)) >= _MIN_WORD_LENGTH
    }


def normalize_word(word: str) -> str:
    stripped = "".join(
        char
        for char in unicodedata.normalize("NFKD", word.replace("ł", "l").replace("Ł", "L"))
        if not unicodedata.combining(char)
    )
    return "".join(_WORD_RE.findall(stripped)).casefold()


def _paint_image(pdf: pikepdf.Pdf, raw: pikepdf.Object, words: set[str]) -> bool:
    from PIL import ImageDraw

    from anonymizer_engine.ocr.core import ocr_image_words

    if raw.get(Name.ImageMask, False):
        return False  # a stencil mask has no pixels of its own to paint
    try:
        image = PdfImage(raw).as_pil_image()
    except Exception as exc:
        raise PdfExportError("An image in the document cannot be read.") from exc
    if min(image.size) < _MIN_IMAGE_SIDE:
        return False

    recognized = ocr_image_words(image)
    boxes = [
        _to_image_box(word, recognized.rotation, image.size)
        for word in recognized.words
        if normalize_word(word.text) in words
    ]
    if not boxes:
        return False

    image = image.convert("RGB")
    draw = ImageDraw.Draw(image)
    for left, top, right, bottom in boxes:
        pad = max(2, round(0.2 * (bottom - top)))
        draw.rectangle((left - pad, top - pad, right + pad, bottom + pad), fill=_REDACTION_FILL)
    _replace_pixels(pdf, raw, image)
    return True


def _to_image_box(word: object, rotation: int, size: tuple[int, int]) -> tuple[int, ...]:
    """Word box in the upright OCR image -> box in the image as stored in the PDF."""
    width, height = size
    left, top = word.left, word.top
    right, bottom = left + word.width, top + word.height
    # OCR turned the image clockwise by ``rotation`` degrees before recognizing it.
    if rotation == 90:
        return (top, height - right, bottom, height - left)
    if rotation == 180:
        return (width - right, height - bottom, width - left, height - top)
    if rotation == 270:
        return (width - bottom, left, width - top, right)
    return (left, top, right, bottom)


def _replace_pixels(pdf: pikepdf.Pdf, raw: pikepdf.Object, image: object) -> None:
    """Write new pixels into the existing image object (same place, size and soft mask)."""
    encoded = io.BytesIO()
    image.save(encoded, format="JPEG", quality=90)
    for key in (Name.DecodeParms, Name.Decode, Name.Mask, Name.Intent):
        if key in raw:
            del raw[key]
    raw.write(encoded.getvalue(), filter=Name.DCTDecode)
    raw.Width = image.width
    raw.Height = image.height
    raw.ColorSpace = Name.DeviceRGB
    raw.BitsPerComponent = 8
