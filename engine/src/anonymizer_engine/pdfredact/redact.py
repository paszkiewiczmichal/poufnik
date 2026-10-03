"""Anonymize a PDF in place: remove the glyphs of every value and draw its token instead.

The glyphs of an anonymized value are deleted from the text-showing operator that drew
them and replaced by an equivalent horizontal offset, so every other character on the line
keeps its exact position. The token is drawn where the value began, in Helvetica, in the
colour and size of the original text (narrowed to fit the freed space). Everything else on
the page - fonts, vector graphics, images - is left as it was.

After saving, the result is parsed again: no anonymized value may remain in its text or
anywhere in its content streams, otherwise the export fails instead of returning a file.
"""

from __future__ import annotations

import io
import math
import re
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

import pikepdf
from pdfminer.cmapdb import IdentityCMap, IdentityCMapByte
from pikepdf import Dictionary, Name

from anonymizer_engine.anonymize.models import OffsetMapEntry
from anonymizer_engine.parsers.exceptions import ParserError
from anonymizer_engine.pdfredact.sanitize import sanitize
from anonymizer_engine.pdfredact.textmap import GlyphRecord, PageMap, PdfTextMap, build_text_map

_TEXT_SHOWING = {"Tj", "TJ", "'", '"'}
_TOKEN_RE = re.compile(r"\[[A-ZĄĆĘŁŃÓŚŹŻ]+(?:_[A-ZĄĆĘŁŃÓŚŹŻ]+)*_\d+\]")
_MIN_VALUE_LENGTH = 3
_MIN_RAW_SCAN_LENGTH = 4
_LABEL_MIN_HSCALE = 60.0
_LABEL_MIN_SIZE_RATIO = 0.75
_INVISIBLE_RENDER_MODES = {3, 7}
_REDACTION_FILL = "0.92"
NOTICE_IMAGES = "images_or_objects_present"
_SCAN_DPI = 300


class PdfExportError(ParserError):
    """The PDF could not be anonymized in place without risking a leak."""


class ScannedPageError(PdfExportError):
    """A value sits on a scanned page: its pixels, not glyphs, carry the data."""


@dataclass(frozen=True)
class Replacement:
    start: int
    end: int
    token: str


@dataclass
class LoadedPdf:
    pdf: pikepdf.Pdf
    data: bytes
    text_map: PdfTextMap
    notices: list[str]


def load(data: bytes, *, max_pages: int | None = None) -> LoadedPdf:
    """Open ``data``, sanitize it and build its text map (object ids match ``pdf``)."""
    try:
        source = pikepdf.open(io.BytesIO(data))
    except pikepdf.PasswordError as exc:
        from anonymizer_engine.parsers.exceptions import PasswordProtectedPdf

        raise PasswordProtectedPdf("PDF file is password-protected.") from exc
    except Exception as exc:
        from anonymizer_engine.parsers.exceptions import CorruptedFile

        raise CorruptedFile("PDF file is corrupted or not a valid PDF document.") from exc
    if max_pages is not None and len(source.pages) > max_pages:
        from anonymizer_engine.parsers.exceptions import DocumentTooLarge

        raise DocumentTooLarge(
            f"PDF page count exceeds the safety limit ({len(source.pages)} > {max_pages})."
        )
    notices = sanitize(source)
    buffer = io.BytesIO()
    source.save(buffer)
    sanitized = buffer.getvalue()
    # Reopen the saved bytes so object numbers are exactly the ones pdfminer reads.
    pdf = pikepdf.open(io.BytesIO(sanitized))
    text_map = build_text_map(sanitized)
    if any(page.images for page in text_map.pages):
        # Photos, stamps or signatures drawn as images are not rewritten unless they sit
        # under anonymized text; the user has to check them.
        notices.append(NOTICE_IMAGES)
    return LoadedPdf(pdf=pdf, data=sanitized, text_map=text_map, notices=notices)


def anonymize_pdf_in_place(
    data: bytes,
    offset_map: Sequence[OffsetMapEntry],
    anonymized_text: str,
) -> bytes:
    loaded = load(data)
    text_map = loaded.text_map
    replacements = validated_replacements(text_map.text, offset_map, anonymized_text)
    values = SensitiveValues(text_map.text, replacements)

    removals: dict[tuple[tuple[str, int], int], dict[int, GlyphRecord]] = defaultdict(dict)
    labels: dict[int, list[Label]] = defaultdict(list)
    areas: dict[int, list[tuple[float, float, float, float]]] = defaultdict(list)
    scan_pages: set[int] = set()
    for replacement in replacements:
        chars = text_map.chars_in(replacement.start, replacement.end)
        if not chars:
            raise PdfExportError("An anonymized span has no glyphs in the document.")
        for page_index, char_index in [*chars, *_blank_glyphs_between(text_map, chars)]:
            page = text_map.pages[page_index]
            glyph = page.glyphs[char_index]
            if glyph.render_mode in _INVISIBLE_RENDER_MODES or _over_image(page, char_index):
                # An OCR text layer over a scan: the pixels show the value too.
                scan_pages.add(page_index)
            areas[page_index].extend(_word_boxes(page, char_index))
            removals[(glyph.stream, glyph.op_index)][glyph.glyph_index] = glyph
        label = Label.for_span(text_map, chars, replacement.token)
        labels[chars[0][0]].append(label)
        page = text_map.pages[chars[0][0]]
        for char_index in label.covered_blanks:
            glyph = page.glyphs[char_index]
            removals[(glyph.stream, glyph.op_index)][glyph.glyph_index] = glyph

    pdf = loaded.pdf
    _rewrite_streams(pdf, text_map, removals)
    for page_index, page_labels in labels.items():
        _draw_labels(pdf, text_map.pages[page_index], page_labels)
    for page_index in sorted(scan_pages):
        # The raster is rendered from the original page, so every value on it - not only
        # those over the scan image - must be painted over.
        page_map = text_map.pages[page_index]
        _replace_scan_with_redacted_raster(pdf, loaded.data, page_map, areas[page_index])
    for page_map in text_map.pages:
        if page_map.rotation != page_map.declared_rotation:
            # The page was read in another quarter turn to get upright text: show it so.
            pdf.pages[page_map.index].obj.Rotate = page_map.rotation
    pdf.remove_unreferenced_resources()

    output = io.BytesIO()
    pdf.save(output, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    content = output.getvalue()
    _verify(content, anonymized_text, values)
    if scan_pages:
        from anonymizer_engine.pdfredact.scan import verify_rasters

        verify_rasters(content, sorted(scan_pages), anonymized_text, values)
    return content


# ------------------------------------------------------------ validation
def validated_replacements(
    text: str,
    offset_map: Sequence[OffsetMapEntry],
    anonymized_text: str,
) -> list[Replacement]:
    replacements = sorted(
        (
            Replacement(entry.original_start, entry.original_end, entry.token)
            for entry in offset_map
        ),
        key=lambda item: (item.start, item.end),
    )
    parts: list[str] = []
    cursor = 0
    for replacement in replacements:
        if (
            replacement.start < cursor
            or replacement.end > len(text)
            or (replacement.end <= replacement.start)
        ):
            raise PdfExportError("Replacement spans overlap or exceed the document text.")
        parts.append(text[cursor : replacement.start])
        parts.append(replacement.token)
        cursor = replacement.end
    parts.append(text[cursor:])
    if "".join(parts) != anonymized_text:
        raise PdfExportError(
            "The source document does not match the anonymization result "
            "(the file was changed after it was imported)."
        )
    return replacements


def _blank_glyphs_between(
    text_map: PdfTextMap,
    chars: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """Space glyphs drawn inside a value ("Jan Kowalski") - pdfplumber maps none of them.

    Left in place they are invisible but would split the token when the text is read.
    """
    by_page: dict[int, list[int]] = defaultdict(list)
    for page_index, char_index in chars:
        by_page[page_index].append(char_index)
    blanks: list[tuple[int, int]] = []
    for page_index, indices in by_page.items():
        page = text_map.pages[page_index]
        taken = set(indices)
        for char_index in range(min(indices), max(indices) + 1):
            if char_index not in taken and not page.chars[char_index]["text"].strip():
                blanks.append((page_index, char_index))
    return blanks


def _word_boxes(page: PageMap, char_index: int) -> list[tuple[float, float, float, float]]:
    """Boxes of the whole word around a glyph: OCR glyph boxes are approximate, so on a
    raster the paint must reach from space to space or edges of the value stay visible."""
    chars = page.chars
    top = chars[char_index]["top"]

    def same_word(index: int) -> bool:
        char = chars[index]
        return bool(char["text"].strip()) and abs(char["top"] - top) < 0.5 * (
            char["bottom"] - char["top"] or 1.0
        )

    left = char_index
    while left > 0 and same_word(left - 1):
        left -= 1
    right = char_index
    while right + 1 < len(chars) and same_word(right + 1):
        right += 1
    return [_device_box(page, index) for index in range(left, right + 1)]


def _device_box(page: PageMap, char_index: int) -> tuple[float, float, float, float]:
    char = page.chars[char_index]
    shift = float(char["x0"]) - float(page.glyphs[char_index].x0)
    return (char["x0"] - shift, char["y0"], char["x1"] - shift, char["y1"])


def _over_image(page: PageMap, char_index: int) -> bool:
    """A visible glyph drawn on top of a large image is most likely an OCR layer."""
    char = page.chars[char_index]
    cx = (char["x0"] + char["x1"]) / 2
    cy = (char["y0"] + char["y1"]) / 2
    for image in page.images:
        x0, y0, x1, y1 = image["bbox"]
        large = (x1 - x0) * (y1 - y0) > 0.25 * page.width * page.height
        if large and x0 <= cx <= x1 and y0 <= cy <= y1:
            return True
    return False


# --------------------------------------------------------- glyph removal
def _rewrite_streams(
    pdf: pikepdf.Pdf,
    text_map: PdfTextMap,
    removals: dict[tuple[tuple[str, int], int], dict[int, GlyphRecord]],
) -> None:
    by_stream: dict[tuple[str, int], dict[int, dict[int, GlyphRecord]]] = defaultdict(dict)
    for (stream, op_index), glyphs in removals.items():
        by_stream[stream][op_index] = glyphs

    pages_by_objid = {page.obj.objgen[0]: page for page in pdf.pages}
    for stream, ops in by_stream.items():
        kind, objid = stream
        if kind == "page":
            target = pages_by_objid.get(objid)
        else:
            target = pdf.get_object((objid, 0)) if objid > 0 else None
        if target is None:
            raise PdfExportError("A content stream holding anonymized text was not found.")
        instructions = pikepdf.parse_content_stream(target)
        rewritten: list[object] = []
        text_op = -1
        for instruction in instructions:
            if isinstance(instruction, pikepdf.ContentStreamInlineImage):
                rewritten.append(instruction)
                continue
            operator = str(instruction.operator)
            if operator not in _TEXT_SHOWING:
                rewritten.append(instruction)
                continue
            text_op += 1
            glyphs = ops.get(text_op)
            if not glyphs:
                rewritten.append(instruction)
                continue
            rewritten.extend(_without_glyphs(instruction, operator, glyphs))
        missing = set(ops) - set(range(text_op + 1))
        if missing:
            raise PdfExportError("Text operators of the document could not be matched.")
        data = pikepdf.unparse_content_stream(rewritten)
        if isinstance(target, pikepdf.Page):
            target.obj.Contents = pdf.make_stream(data)
        else:
            target.write(data)


def _without_glyphs(
    instruction: pikepdf.ContentStreamInstruction,
    operator: str,
    glyphs: dict[int, GlyphRecord],
) -> list[pikepdf.ContentStreamInstruction]:
    operands = list(instruction.operands)
    prefix: list[pikepdf.ContentStreamInstruction] = []
    if operator == "TJ":
        elements = list(operands[0])
    elif operator == "Tj":
        elements = [operands[0]]
    elif operator == "'":
        prefix.append(pikepdf.ContentStreamInstruction([], pikepdf.Operator("T*")))
        elements = [operands[0]]
    else:  # '"': aw ac string
        prefix.append(pikepdf.ContentStreamInstruction([operands[0]], pikepdf.Operator("Tw")))
        prefix.append(pikepdf.ContentStreamInstruction([operands[1]], pikepdf.Operator("Tc")))
        prefix.append(pikepdf.ContentStreamInstruction([], pikepdf.Operator("T*")))
        elements = [operands[2]]

    sample = next(iter(glyphs.values()))
    code_length = _code_length(sample.font)
    result: list[object] = []
    pending = b""
    glyph_index = 0

    def flush() -> None:
        nonlocal pending
        if pending:
            result.append(pikepdf.String(pending))
            pending = b""

    for element in elements:
        if not isinstance(element, pikepdf.String):
            flush()
            _append_number(result, float(element))
            continue
        raw = bytes(element)
        for offset in range(0, len(raw) - len(raw) % code_length, code_length):
            code = raw[offset : offset + code_length]
            glyph = glyphs.get(glyph_index)
            if glyph is None:
                pending += code
            else:
                decoded = list(glyph.font.decode(code))
                if decoded != [glyph.cid]:
                    raise PdfExportError("A glyph of the document could not be identified.")
                flush()
                _append_number(result, _replacement_offset(glyph, code))
            glyph_index += 1
    flush()
    return [
        *prefix,
        pikepdf.ContentStreamInstruction([pikepdf.Array(result)], pikepdf.Operator("TJ")),
    ]


def _code_length(font: object) -> int:
    if getattr(font, "is_vertical", lambda: False)():
        raise PdfExportError("Vertical text is not supported for in-place PDF anonymization.")
    if not font.is_multibyte():
        return 1
    cmap = getattr(font, "cmap", None)
    if isinstance(cmap, IdentityCMapByte):
        return 1
    if isinstance(cmap, IdentityCMap):
        return 2
    raise PdfExportError("The document uses a font encoding that cannot be edited safely.")


def _replacement_offset(glyph: GlyphRecord, code: bytes) -> float:
    """TJ adjustment that moves the pen exactly as far as the removed glyph did.

    Glyph advance: (w0 * Tfs + Tc + Tw) * Th; TJ number n moves by -(n / 1000) * Tfs * Th,
    so n = -(w0 * 1000 + (Tc + Tw) * 1000 / Tfs). Tw applies to single-byte code 32 only.
    """
    if glyph.fontsize == 0:
        raise PdfExportError("Text with zero font size cannot be edited safely.")
    word_space = glyph.wordspace if (len(code) == 1 and code == b" ") else 0.0
    width = glyph.font.char_width(glyph.cid)
    return -(width * 1000 + (glyph.charspace + word_space) * 1000 / glyph.fontsize)


def _append_number(result: list[object], value: float) -> None:
    if result and isinstance(result[-1], float):
        result[-1] = result[-1] + value
    else:
        result.append(value)


# ---------------------------------------------------------------- labels
@dataclass
class Label:
    """Where and how a token is drawn, fitted to the free space at the value's start."""

    token: str
    origin: tuple[float, float]  # pdfminer device space (page coordinates without MediaBox shift)
    direction: tuple[float, float]
    size: float
    hscale: float
    drawn: float  # width of the drawn token along the baseline
    extent: float  # length of the removed value along the baseline
    below: float  # extent of the removed glyphs under / over the baseline
    above: float
    color: tuple[float, ...]
    covered_blanks: list[int]  # space glyphs under the token, removed so it reads as one word

    @classmethod
    def for_span(cls, text_map: PdfTextMap, chars: list[tuple[int, int]], token: str) -> Label:
        page = text_map.pages[chars[0][0]]
        first = page.chars[chars[0][1]]
        glyph = page.glyphs[chars[0][1]]
        a, b, c, d, e, f = first["matrix"]
        norm = math.hypot(a, b) or 1.0
        direction = (a / norm, b / norm)
        normal = (-direction[1], direction[0])
        # pdfminer's char matrix is Tm x CTM without the font size, which is applied apart.
        size = abs(glyph.fontsize) * math.hypot(c, d) or first.get("size") or 10.0
        mb_x0 = float(first["x0"]) - float(glyph.x0)
        own = {index for page_index, index in chars if page_index == chars[0][0]}

        def along(x: float, y: float) -> float:
            return (x - e) * direction[0] + (y - f) * direction[1]

        def across(x: float, y: float) -> float:
            return (x - e) * normal[0] + (y - f) * normal[1]

        def same_line(char: dict) -> bool:
            middle = across(char["x0"] - mb_x0, (char["y0"] + char["y1"]) / 2)
            return abs(middle - 0.3 * size) <= 0.6 * size

        extent, below, above = 0.0, 0.0, 0.0
        for index in own:
            char = page.chars[index]
            if not same_line(char):
                continue  # a value broken over two lines keeps its token on the first one
            for x in (char["x0"] - mb_x0, char["x1"] - mb_x0):
                for y in (char["y0"], char["y1"]):
                    extent = max(extent, along(x, y))
                    below, above = min(below, across(x, y)), max(above, across(x, y))

        # Free room: up to the next glyph of other text on the line, or the page edge.
        nearest: float | None = None
        blanks: list[tuple[float, int]] = []
        for index, char in enumerate(page.chars):
            if index in own or not same_line(char):
                continue
            start = along(char["x0"] - mb_x0, char["y0"])
            if start < 0:
                continue
            if not char["text"].strip():
                blanks.append((start, index))
            elif nearest is None or start < nearest:
                nearest = start
        if nearest is not None:
            room = nearest - 0.15 * size
        else:
            corners = [(0.0, 0.0), (page.width, 0.0), (0.0, page.height), (page.width, page.height)]
            room = max(along(x, y) for x, y in corners) - 0.5 * size
        room = max(room, 0.5 * size)

        size, hscale, drawn = fit_token(token, size, room)
        color = tuple(first.get("non_stroking_color") or (0,))
        return cls(
            token=token,
            origin=(e, f),
            direction=direction,
            size=size,
            hscale=hscale,
            drawn=drawn,
            extent=extent,
            below=below if above > below else -0.2 * size,
            above=above if above > below else 0.8 * size,
            color=color if all(isinstance(v, (int, float)) for v in color) else (0,),
            covered_blanks=[index for start, index in blanks if start < max(drawn, extent)],
        )


def fit_token(token: str, size: float, room: float) -> tuple[float, float, float]:
    """Font size, horizontal scale (Tz) and drawn width of a token that should fit ``room``:
    narrowed first (down to 60 %), then made smaller (down to 75 %), then allowed to run on."""
    from reportlab.pdfbase.pdfmetrics import stringWidth

    hscale = 100.0
    width = stringWidth(token, "Helvetica", size)
    if width > room:
        hscale = max(_LABEL_MIN_HSCALE, 100.0 * room / width)
        scaled = width * hscale / 100.0
        if scaled > room:
            size = max(size * _LABEL_MIN_SIZE_RATIO, size * room / scaled)
    return size, hscale, stringWidth(token, "Helvetica", size) * hscale / 100.0


def _draw_labels(pdf: pikepdf.Pdf, page_map: PageMap, labels: list[Label]) -> None:
    draw_labels(pdf, page_map.index, page_map.ctm, labels)


def draw_labels(
    pdf: pikepdf.Pdf,
    page_index: int,
    ctm: tuple[float, ...],
    labels: list[Label],
) -> None:
    """Draw each token over a light box; label geometry is in ``ctm`` (device) space."""
    page = pdf.pages[page_index]
    font = Dictionary(
        Type=Name.Font,
        Subtype=Name.Type1,
        BaseFont=Name.Helvetica,
        Encoding=Name.WinAnsiEncoding,
    )
    font_name = page.add_resource(font, Name.Font, prefix="PoufnikF")
    inverse = _invert(ctm)
    commands: list[str] = []
    for label in labels:
        x, y = _apply(inverse, label.origin)
        ux, uy = _apply_linear(inverse, label.direction)
        norm = math.hypot(ux, uy) or 1.0
        ux, uy = ux / norm, uy / norm
        # A light box over the whole removed value marks the redaction, so the space the
        # (usually shorter) token leaves behind reads as intentional, not as a gap.
        box_width = max(label.extent, label.drawn)
        box_height = label.above - label.below
        commands.append(
            f"q {ux:.5f} {uy:.5f} {-uy:.5f} {ux:.5f} {x:.3f} {y:.3f} cm "
            + f"{_REDACTION_FILL} g 0 {label.below:.3f} {box_width:.3f} {box_height:.3f} re f "
            + _color_operator(label.color)
            + f" BT {font_name} {label.size:.3f} Tf {label.hscale:.2f} Tz 0 0 Td "
            + f"({label.token}) Tj ET Q"
        )
    page.contents_add(b"q\n", prepend=True)
    page.contents_add(("\nQ\n" + "\n".join(commands) + "\n").encode("ascii"), prepend=False)


# ------------------------------------------------------------------ scans
def _replace_scan_with_redacted_raster(
    pdf: pikepdf.Pdf,
    source: bytes,
    page_map: PageMap,
    areas: list[tuple[float, float, float, float]],
) -> None:
    """Swap the page's images for one raster of the page with the values painted over.

    The original scan image would still show every value, so it is dropped from the page
    (and, being unreferenced, from the file); text and vector content stay on top.
    """
    import pypdfium2 as pdfium
    from PIL import ImageDraw

    document = pdfium.PdfDocument(source)
    try:
        rendered = document[page_map.index]
        rendered.set_rotation(0)
        crop_x0, crop_y0, crop_x1, crop_y1 = rendered.get_cropbox()
        scale = _SCAN_DPI / 72
        bitmap = rendered.render(scale=scale)
        image = bitmap.to_pil().convert("RGB")
        bitmap.close()
    finally:
        document.close()

    inverse = _invert(page_map.ctm)
    draw = ImageDraw.Draw(image)
    for x0, y0, x1, y1 in areas:
        # Generous margin (a quarter of the line height): scanned glyphs bleed past boxes.
        pad = 0.25 * abs(y1 - y0) * scale
        corners = [_apply(inverse, (x, y)) for x in (x0, x1) for y in (y0, y1)]
        xs = [(ux - crop_x0) * scale for ux, _uy in corners]
        ys = [(crop_y1 - uy) * scale for _ux, uy in corners]
        draw.rectangle((min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad), fill="white")

    page = pdf.pages[page_map.index]
    image_name = page.add_resource(image_stream(pdf, image), Name.XObject, prefix="PoufnikScan")
    kept = [
        instruction
        for instruction in pikepdf.parse_content_stream(page)
        if not isinstance(instruction, pikepdf.ContentStreamInlineImage)
        and str(instruction.operator) != "Do"
    ]
    width, height = crop_x1 - crop_x0, crop_y1 - crop_y0
    raster = f"q {width:.4f} 0 0 {height:.4f} {crop_x0:.4f} {crop_y0:.4f} cm {image_name} Do Q\n"
    content = raster.encode("ascii") + pikepdf.unparse_content_stream(kept)
    page.obj.Contents = pdf.make_stream(content)


def image_stream(pdf: pikepdf.Pdf, image: object) -> pikepdf.Stream:
    """Bilevel scans stay 1-bit (Flate), everything else becomes a grey or colour JPEG."""
    import zlib

    from PIL import ImageChops

    gray = image.convert("L")
    histogram = gray.histogram()
    extremes = sum(histogram[:24]) + sum(histogram[232:])
    if extremes >= 0.985 * gray.width * gray.height:
        bilevel = gray.point(lambda value: 255 if value > 127 else 0).convert("1")
        return pikepdf.Stream(
            pdf,
            zlib.compress(bilevel.tobytes()),
            Type=Name.XObject,
            Subtype=Name.Image,
            Width=bilevel.width,
            Height=bilevel.height,
            ColorSpace=Name.DeviceGray,
            BitsPerComponent=1,
            Filter=Name.FlateDecode,
        )
    colourless = not ImageChops.difference(image, gray.convert("RGB")).getbbox()
    encoded = io.BytesIO()
    (gray if colourless else image).save(encoded, format="JPEG", quality=85)
    return pikepdf.Stream(
        pdf,
        encoded.getvalue(),
        Type=Name.XObject,
        Subtype=Name.Image,
        Width=image.width,
        Height=image.height,
        ColorSpace=Name.DeviceGray if colourless else Name.DeviceRGB,
        BitsPerComponent=8,
        Filter=Name.DCTDecode,
    )


def _color_operator(color: tuple[float, ...]) -> str:
    values = " ".join(f"{max(0.0, min(1.0, float(v))):.4f}" for v in color)
    return {1: f"{values} g", 3: f"{values} rg", 4: f"{values} k"}.get(len(color), "0 g")


def _invert(m: tuple[float, ...]) -> tuple[float, ...]:
    a, b, c, d, e, f = m
    det = a * d - b * c
    if det == 0:
        raise PdfExportError("The page has a degenerate coordinate system.")
    return (d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det)


def _apply(m: tuple[float, ...], point: tuple[float, float]) -> tuple[float, float]:
    a, b, c, d, e, f = m
    x, y = point
    return (a * x + c * y + e, b * x + d * y + f)


def _apply_linear(m: tuple[float, ...], vector: tuple[float, float]) -> tuple[float, float]:
    a, b, c, d, _e, _f = m
    x, y = vector
    return (a * x + c * y, b * x + d * y)


# ----------------------------------------------------------- verification
class SensitiveValues:
    def __init__(self, text: str, replacements: Sequence[Replacement]) -> None:
        values = {
            " ".join(text[r.start : r.end].split())
            for r in replacements
            if len(" ".join(text[r.start : r.end].split())) >= _MIN_VALUE_LENGTH
        }
        self.values = sorted(values, key=len, reverse=True)
        self.tokens = Counter(r.token for r in replacements)
        if self.values:
            body = "|".join(
                r"\s*".join(re.escape(ch) for ch in v.replace(" ", "")) for v in self.values
            )
            self.pattern: re.Pattern[str] | None = re.compile(
                rf"(?<!\w)(?:{body})(?!\w)", re.IGNORECASE
            )
        else:
            self.pattern = None

    def count(self, text: str) -> Counter[str]:
        if self.pattern is None:
            return Counter()
        return Counter("".join(m.group(0).split()).casefold() for m in self.pattern.finditer(text))


def _verify(content: bytes, anonymized_text: str, values: SensitiveValues) -> None:
    loaded = load(content)
    text = loaded.text_map.text

    expected = values.count(anonymized_text)
    actual = values.count(text)
    if any(count > expected[value] for value, count in actual.items()):
        raise PdfExportError(
            "Verification failed: an anonymized value is still in the document text."
        )
    found_tokens = Counter(_TOKEN_RE.findall(text))
    if any(found_tokens[token] < 1 for token in values.tokens):
        raise PdfExportError(
            "Verification failed: anonymization tokens are missing in the document."
        )

    leftovers = _raw_stream_hits(loaded.pdf, values)
    if leftovers:
        raise PdfExportError(
            "Verification failed: anonymized values remain in the PDF data "
            f"({', '.join(sorted(leftovers))})."
        )
    if set(loaded.notices) - {NOTICE_IMAGES}:
        raise PdfExportError("Verification failed: the exported PDF still has removable content.")


def _raw_stream_hits(pdf: pikepdf.Pdf, values: SensitiveValues) -> set[str]:
    """Look for values written as plain bytes in any content stream or string object."""
    needles: list[bytes] = []
    for value in values.values:
        if len(value) < _MIN_RAW_SCAN_LENGTH:
            continue
        for encoding in ("cp1252", "utf-16-be", "utf-8"):
            try:
                needles.append(value.encode(encoding))
            except UnicodeEncodeError:
                continue
    if not needles:
        return set()
    hits: set[str] = set()
    for obj in pdf.objects:
        if isinstance(obj, pikepdf.Stream):
            subtype = obj.get(Name.Subtype)
            if subtype == Name.Image or Name.Length1 in obj or Name.Length2 in obj:
                continue  # pixels and font programs
            try:
                data = obj.read_bytes()
            except Exception:
                continue
            if any(needle in data for needle in needles):
                hits.add(f"object {obj.objgen[0]}")
        elif isinstance(obj, pikepdf.String):
            data = bytes(obj)
            if any(needle in data for needle in needles):
                hits.add(f"object {obj.objgen[0]}")
    return hits
