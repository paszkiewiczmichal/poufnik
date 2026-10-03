"""Small helpers to build test PDFs and to run an in-place export on them."""

from __future__ import annotations

import io
from collections import Counter
from collections.abc import Callable

import pikepdf
from pikepdf import Dictionary, Name

from anonymizer_engine.anonymize import OffsetMapEntry
from anonymizer_engine.parsers import parse_pdf
from anonymizer_engine.pdfredact import load


def raw_pdf(
    content: bytes,
    *,
    rotate: int = 0,
    mediabox: tuple[float, ...] = (0, 0, 595, 842),
    extra_resources: Callable[[pikepdf.Pdf], dict] | None = None,
    info: dict | None = None,
) -> bytes:
    """One page drawing ``content`` with Times-Roman as /F1 (labels use Helvetica)."""
    pdf = pikepdf.new()
    font = pdf.make_indirect(
        Dictionary(
            Type=Name.Font,
            Subtype=Name.Type1,
            BaseFont=Name("/Times-Roman"),
            Encoding=Name.WinAnsiEncoding,
        )
    )
    resources = Dictionary(Font=Dictionary(F1=font))
    for key, value in (extra_resources(pdf) if extra_resources else {}).items():
        resources[key] = value
    page = pikepdf.Page(
        Dictionary(
            Type=Name.Page,
            MediaBox=list(mediabox),
            Resources=resources,
            Contents=pdf.make_stream(content),
        )
    )
    if rotate:
        page.obj.Rotate = rotate
    pdf.pages.append(page)
    for key, value in (info or {}).items():
        pdf.docinfo[key] = value
    buffer = io.BytesIO()
    pdf.save(buffer)
    return buffer.getvalue()


def spans_for(text: str, *values: tuple[str, str]) -> tuple[list[OffsetMapEntry], str]:
    """Offset map and anonymized text replacing every occurrence of each value."""
    spans: list[tuple[int, int, str]] = []
    for value, token in values:
        start = text.find(value)
        assert start >= 0, f"{value!r} not in {text!r}"
        while start >= 0:
            spans.append((start, start + len(value), token))
            start = text.find(value, start + len(value))
    spans.sort()
    entries: list[OffsetMapEntry] = []
    parts: list[str] = []
    cursor = position = 0
    for start, end, token in spans:
        parts.append(text[cursor:start])
        position += start - cursor
        entries.append(
            OffsetMapEntry(
                original_start=start,
                original_end=end,
                anonymized_start=position,
                anonymized_end=position + len(token),
                token=token,
                category="PERSON",
            )
        )
        parts.append(token)
        position += len(token)
        cursor = end
    parts.append(text[cursor:])
    return entries, "".join(parts)


def text_of(data: bytes) -> str:
    """Text-layer reading (short test pages would otherwise be treated as scans)."""
    return parse_pdf(data).text


def glyph_positions(
    data: bytes,
    *,
    exclude_font: str = "Helvetica",
    blanks: bool = False,
) -> Counter:
    """(page, text, x0, y0) of every glyph not drawn in ``exclude_font`` (the labels),
    read with Poufnik's own interpreter (pdfminer misplaces the " operator). Space glyphs
    are included only with ``blanks``."""
    pages = load(data).text_map.pages
    return Counter(
        (page.index, char["text"], round(char["x0"], 2), round(char["y0"], 2))
        for page in pages
        for char in page.chars
        if (blanks or char["text"].strip()) and not char["fontname"].endswith(exclude_font)
    )
