"""Anonymize a scanned PDF without a text layer (text recognized by OCR).

The page images carry the values, so every page holding one is rendered again with the
words of each value painted over, and that raster replaces the original page content - the
original scan image, unreferenced, leaves the file. The token is drawn on top as text, in
a light box, like in text PDFs.

Before returning, every rebuilt page is recognized again: if OCR still reads any value the
user anonymized, the export fails instead of returning a file.
"""

from __future__ import annotations

import ctypes
import io
import math
import statistics
from collections import defaultdict
from collections.abc import Sequence

import pikepdf
from pikepdf import Name

from anonymizer_engine.anonymize.models import OffsetMapEntry
from anonymizer_engine.ocr.core import OcrPage, OcrPdfMap, ocr_image, ocr_pdf_mapped
from anonymizer_engine.pdfredact.redact import (
    Label,
    PdfExportError,
    SensitiveValues,
    draw_labels,
    fit_token,
    image_stream,
    validated_replacements,
)
from anonymizer_engine.pdfredact.sanitize import sanitize

_IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def sanitized_pdf(data: bytes) -> tuple[bytes, list[str]]:
    """Sanitize a PDF (see :mod:`.sanitize`) and return the saved bytes and notices."""
    pdf = pikepdf.open(io.BytesIO(data))
    notices = sanitize(pdf)
    buffer = io.BytesIO()
    pdf.save(buffer)
    return buffer.getvalue(), notices


def anonymize_scanned_pdf(
    data: bytes,
    offset_map: Sequence[OffsetMapEntry],
    anonymized_text: str,
) -> bytes:
    source, _notices = sanitized_pdf(data)
    parsed, ocr_map = ocr_pdf_mapped(source)
    replacements = validated_replacements(parsed.text, offset_map, anonymized_text)
    values = SensitiveValues(parsed.text, replacements)

    painted: dict[int, set[int]] = defaultdict(set)
    first_words: list[tuple[int, list[int], str]] = []
    for replacement in replacements:
        owned = _owned_words(ocr_map, replacement.start, replacement.end)
        if not owned:
            raise PdfExportError("An anonymized span has no recognized words in the document.")
        for page_index, word_index in owned:
            painted[page_index].add(word_index)
        page_index = owned[0][0]
        first_words.append(
            (page_index, [w for p, w in owned if p == page_index], replacement.token)
        )

    pdf = pikepdf.open(io.BytesIO(source))
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(source)
    try:
        labels: dict[int, list[Label]] = defaultdict(list)
        for page_index, word_indices, token in first_words:
            page = ocr_map.pages[page_index]
            labels[page_index].append(_label(document[page_index], page, word_indices, token))
        for page_index, words in painted.items():
            _rebuild_page(pdf, document, ocr_map.pages[page_index], words)
            draw_labels(pdf, page_index, _IDENTITY, labels.get(page_index, []))
    finally:
        document.close()
    pdf.remove_unreferenced_resources()

    output = io.BytesIO()
    pdf.save(output, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    content = output.getvalue()
    verify_rasters(content, sorted(painted), anonymized_text, values)
    return content


def _owned_words(ocr_map: OcrPdfMap, start: int, end: int) -> list[tuple[int, int]]:
    seen: set[tuple[int, int]] = set()
    owned: list[tuple[int, int]] = []
    for position in range(start, end):
        page, word = ocr_map.owner_page[position], ocr_map.owner_word[position]
        if word < 0 or (page, word) in seen:
            continue
        seen.add((page, word))
        owned.append((page, word))
    return owned


# ------------------------------------------------------------ geometry
def _to_user(page: object, ocr_page: OcrPage, x: float, y: float) -> tuple[float, float]:
    """Pixel of the OCR render (as displayed) -> PDF user space."""
    import pypdfium2.raw as raw

    user_x, user_y = ctypes.c_double(), ctypes.c_double()
    ok = raw.FPDF_DeviceToPage(
        page.raw,
        0,
        0,
        ocr_page.width_px,
        ocr_page.height_px,
        0,
        int(round(x)),
        int(round(y)),
        ctypes.byref(user_x),
        ctypes.byref(user_y),
    )
    if not ok:
        raise PdfExportError("A scanned page has an unsupported coordinate system.")
    return user_x.value, user_y.value


def _label(page: object, ocr_page: OcrPage, word_indices: list[int], token: str) -> Label:
    words = [ocr_page.words[index] for index in word_indices]
    line = words[0].line
    on_line = [word for word in words if word.line == line]
    left = min(word.left for word in on_line)
    right = max(word.left + word.width for word in on_line)
    height_px = max(word.height for word in on_line)

    # Free room: up to the next recognized word on the same line, or the image edge.
    following = [
        word.left
        for word in ocr_page.words
        if word.line == line and word.left >= right and word not in on_line
    ]
    room_right = (min(following) - 0.35 * height_px) if following else ocr_page.width_px

    # Baseline and size from the whole line: most words have no descenders, so the median
    # bottom is the baseline; the median word box (ascenders and some descenders) is about
    # 0.9 em high.
    line_words = [word for word in ocr_page.words if word.line == line]
    baseline = statistics.median(word.top + word.height for word in line_words)
    cap_height = statistics.median(word.height for word in line_words)
    origin = _to_user(page, ocr_page, left, baseline)
    end = _to_user(page, ocr_page, right, baseline)
    room_end = _to_user(page, ocr_page, room_right, baseline)
    up = _to_user(page, ocr_page, left, baseline - cap_height)
    extent = math.dist(origin, end)
    vector = (end[0] - origin[0], end[1] - origin[1])
    norm = math.hypot(*vector) or 1.0
    direction = (vector[0] / norm, vector[1] / norm)
    size = math.dist(origin, up) / 0.9
    size, hscale, drawn = fit_token(token, size, max(math.dist(origin, room_end), extent))
    below = -0.25 * size
    return Label(
        token=token,
        origin=origin,
        direction=direction,
        size=size,
        hscale=hscale,
        drawn=drawn,
        extent=extent,
        below=below,
        above=size * 0.85,
        color=(0,),
        covered_blanks=[],
    )


# ----------------------------------------------------------- rebuilding
def _rebuild_page(pdf: pikepdf.Pdf, document: object, ocr_page: OcrPage, words: set[int]) -> None:
    """Replace the page content with a raster of it on which the given words are painted."""
    from PIL import ImageDraw

    rendered = document[ocr_page.index]
    corners_by_word = {
        index: [
            _to_user(rendered, ocr_page, x, y)
            for x in (word.left, word.left + word.width)
            for y in (word.top, word.top + word.height)
        ]
        for index in words
        for word in [ocr_page.words[index]]
    }
    rendered.set_rotation(0)
    crop_x0, crop_y0, crop_x1, crop_y1 = rendered.get_cropbox()
    scale = ocr_page.scale
    bitmap = rendered.render(scale=scale)
    image = bitmap.to_pil().convert("RGB")
    bitmap.close()

    draw = ImageDraw.Draw(image)
    for index, corners in corners_by_word.items():
        word = ocr_page.words[index]
        pad = 0.25 * word.height
        xs = [(ux - crop_x0) * scale for ux, _uy in corners]
        ys = [(crop_y1 - uy) * scale for _ux, uy in corners]
        draw.rectangle((min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad), fill="white")

    page = pdf.pages[ocr_page.index]
    name = page.add_resource(image_stream(pdf, image), Name.XObject, prefix="PoufnikScan")
    width, height = crop_x1 - crop_x0, crop_y1 - crop_y0
    content = f"q {width:.4f} 0 0 {height:.4f} {crop_x0:.4f} {crop_y0:.4f} cm {name} Do Q\n"
    page.obj.Contents = pdf.make_stream(content.encode("ascii"))


# ---------------------------------------------------------- verification
def verify_rasters(
    content: bytes,
    pages: list[int],
    anonymized_text: str,
    values: SensitiveValues,
) -> None:
    """OCR the rebuilt pages again; a value the user anonymized must not be readable."""
    import pypdfium2 as pdfium

    left_visible = values.count(anonymized_text)
    document = pdfium.PdfDocument(content)
    try:
        for page_index in pages:
            bitmap = document[page_index].render(scale=300 / 72)
            image = bitmap.to_pil().copy()
            bitmap.close()
            found = values.count(ocr_image(image))
            if any(count > left_visible[value] for value, count in found.items()):
                raise PdfExportError(
                    "Verification failed: an anonymized value is still readable on page "
                    f"{page_index + 1}."
                )
    finally:
        document.close()
