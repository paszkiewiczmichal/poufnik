"""Extract PDF text exactly like the parser does and remember the glyph behind each char.

The canonical text is built from pdfplumber's text map (the same as ``page.extract_text``
followed by the parser's paragraph split), so detection sees an unchanged text. The page
layout pdfplumber reads is produced by our own pdfminer pass which, for every rendered
glyph, records the content stream it came from, the index of the text-showing operator in
that stream and the glyph's position inside that operator. pdfplumber's ``page.chars`` are
generated from that very layout, so char *i* corresponds to glyph record *i*.
"""

from __future__ import annotations

import io
import re
from array import array
from dataclasses import dataclass, field
from typing import Any

import pdfplumber
from pdfminer.layout import LTChar
from pdfminer.pdfinterp import PDFPageInterpreter
from pdfminer.pdftypes import stream_value
from pdfminer.psparser import literal_name

from anonymizer_engine.parsers.exceptions import CorruptedFile
from anonymizer_engine.parsers.models import Block

_PARAGRAPH_SEPARATOR_RE = re.compile(r"\n\s*\n+")

try:  # pdfplumber's aggregator also records marked content; fall back to pdfminer's.
    from pdfplumber.page import PDFPageAggregatorWithMarkedContent as _BaseAggregator
except ImportError:  # pragma: no cover
    from pdfminer.converter import PDFPageAggregator as _BaseAggregator


StreamKey = tuple[str, int]  # ("page", page objid) or ("xobject", stream objid)


@dataclass
class GlyphRecord:
    stream: StreamKey
    op_index: int
    glyph_index: int
    cid: int
    font: Any = field(repr=False)
    fontsize: float
    charspace: float
    wordspace: float
    render_mode: int
    text: str
    x0: float
    y0: float


@dataclass
class PageMap:
    index: int
    objid: int
    ctm: tuple[float, float, float, float, float, float]
    chars: list[dict[str, Any]]
    glyphs: list[GlyphRecord]
    images: list[dict[str, Any]]
    width: float = 0.0
    height: float = 0.0


@dataclass
class PdfTextMap:
    """``owner_page[i]`` / ``owner_char[i]`` locate the char object behind text position *i*
    (``-1`` for whitespace implied by the layout and for separators)."""

    text: str
    blocks: list[Block]
    owner_page: array
    owner_char: array
    pages: list[PageMap]
    extracted_chars: int

    def chars_in(self, start: int, end: int) -> list[tuple[int, int]]:
        """Distinct (page, char index) pairs behind ``text[start:end]``, in text order."""
        seen: set[tuple[int, int]] = set()
        result: list[tuple[int, int]] = []
        for position in range(start, end):
            page, char = self.owner_page[position], self.owner_char[position]
            if char < 0 or (page, char) in seen:
                continue
            seen.add((page, char))
            result.append((page, char))
        return result


class _RecordingInterpreter(PDFPageInterpreter):
    """Counts text-showing operators per content stream and tags the device with them."""

    def __init__(self, rsrcmgr: Any, device: _RecordingDevice, stream: StreamKey) -> None:
        super().__init__(rsrcmgr, device)
        self.stream = stream
        self.text_ops = 0
        self._next_xobject: int | None = None

    def subinterp(self) -> _RecordingInterpreter:
        key: StreamKey = ("xobject", self._next_xobject if self._next_xobject is not None else -1)
        return _RecordingInterpreter(self.rsrcmgr, self.device, key)

    def do_Do(self, xobjid_arg: Any) -> None:  # noqa: N802 - pdfminer naming
        try:
            self._next_xobject = stream_value(self.xobjmap[literal_name(xobjid_arg)]).objid
        except Exception:
            self._next_xobject = None
        super().do_Do(xobjid_arg)

    def do__w(self, aw: Any, ac: Any, s: Any) -> None:
        """The " operator: set Tw and Tc, move to the next line, show text.

        pdfminer skips the move to the next line (PDF 32000-1, table 109: " = aw Tw ac Tc
        string '), which would place the text - and our token - on the wrong line.
        """
        self.do_Tw(aw)
        self.do_Tc(ac)
        self.do_T_a()
        self.do_TJ([s])

    def do_TJ(self, seq: Any) -> None:  # noqa: N802 - pdfminer naming
        # Tj, ', " all funnel into do_TJ: one call per text-showing operator.
        op_index = self.text_ops
        self.text_ops += 1
        self.device.begin_text_op(self.stream, op_index, self.textstate)
        super().do_TJ(seq)


class _RecordingDevice(_BaseAggregator):
    def __init__(self, rsrcmgr: Any, pageno: int) -> None:
        super().__init__(rsrcmgr, pageno=pageno, laparams=None)
        self.glyphs: list[GlyphRecord] = []
        self.images: list[dict[str, Any]] = []
        self._op: tuple[StreamKey, int] | None = None
        self._glyph_in_op = 0
        self._textstate: Any = None
        self.page_ctm: tuple[float, ...] | None = None

    def begin_page(self, page: Any, ctm: Any) -> None:
        self.page_ctm = tuple(ctm)
        super().begin_page(page, ctm)

    def begin_text_op(self, stream: StreamKey, op_index: int, textstate: Any) -> None:
        self._op = (stream, op_index)
        self._glyph_in_op = 0
        self._textstate = textstate

    def render_char(
        self,
        matrix: Any,
        font: Any,
        fontsize: float,
        scaling: float,
        rise: float,
        cid: int,
        ncs: Any,
        graphicstate: Any,
    ) -> float:
        advance = super().render_char(matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate)
        item = self.cur_item._objs[-1]
        assert isinstance(item, LTChar)
        stream, op_index = self._op if self._op is not None else (("page", -1), -1)
        state = self._textstate
        self.glyphs.append(
            GlyphRecord(
                stream=stream,
                op_index=op_index,
                glyph_index=self._glyph_in_op,
                cid=cid,
                font=font,
                fontsize=state.fontsize,
                charspace=state.charspace,
                wordspace=state.wordspace,
                render_mode=state.render,
                text=item.get_text(),
                x0=item.x0,
                y0=item.y0,
            )
        )
        self._glyph_in_op += 1
        return advance

    def render_image(self, name: str, stream: Any) -> None:
        super().render_image(name, stream)
        item = self.cur_item._objs[-1]
        self.images.append(
            {
                "objid": getattr(stream, "objid", None),
                "bbox": (item.x0, item.y0, item.x1, item.y1),
                "ctm": tuple(self.ctm) if self.ctm is not None else None,
            }
        )


def build_text_map(data: bytes) -> PdfTextMap:
    """Parse sanitized PDF bytes into canonical text with a char -> glyph map."""
    builder = _Builder()
    pages: list[PageMap] = []
    extracted = 0
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for index, page in enumerate(pdf.pages):
                device = _RecordingDevice(pdf.rsrcmgr, page.page_number)
                interpreter = _RecordingInterpreter(
                    pdf.rsrcmgr, device, ("page", page.page_obj.pageid)
                )
                interpreter.process_page(page.page_obj)
                page._layout = device.get_result()  # pdfplumber reads chars from this layout
                chars = page.chars
                _check_alignment(chars, device.glyphs, index, float(page.mediabox[0]))
                pages.append(
                    PageMap(
                        index=index,
                        objid=page.page_obj.pageid,
                        ctm=device.page_ctm or (1, 0, 0, 1, 0, 0),
                        chars=chars,
                        glyphs=device.glyphs,
                        images=device.images,
                        width=float(page.width),
                        height=float(page.height),
                    )
                )
                if index > 0:
                    builder.page_break()
                textmap = page._get_textmap()
                page_chars, page_owner = _expand(textmap.tuples, chars)
                extracted += len("".join(page_chars).strip())
                builder.page_paragraphs(page_chars, page_owner, index)
    except (CorruptedFile, ValueError):
        raise
    except Exception as exc:  # pragma: no cover - pdfminer raises many exception types
        raise CorruptedFile("PDF file is corrupted or not a valid PDF document.") from exc

    return PdfTextMap(
        text="".join(builder.parts),
        blocks=builder.blocks,
        owner_page=builder.owner_page,
        owner_char=builder.owner_char,
        pages=pages,
        extracted_chars=extracted,
    )


def _check_alignment(
    chars: list[dict[str, Any]],
    glyphs: list[GlyphRecord],
    page: int,
    mediabox_x0: float,
) -> None:
    if len(chars) != len(glyphs):
        raise ValueError(f"PDF page {page + 1}: glyph map does not match extracted characters.")
    for char, glyph in zip(chars, glyphs, strict=True):
        # pdfplumber shifts x by the MediaBox origin; y0 is pdfminer's untouched value.
        if abs(char["x0"] - mediabox_x0 - glyph.x0) > 0.01 or abs(char["y0"] - glyph.y0) > 0.01:
            raise ValueError(f"PDF page {page + 1}: glyph order does not match characters.")


def _expand(
    tuples: list[tuple[str, dict[str, Any] | None]],
    chars: list[dict[str, Any]],
) -> tuple[list[str], list[int | None]]:
    """One entry per output character with the index of the char object behind it."""
    index_of = {id(char): position for position, char in enumerate(chars)}
    out_chars: list[str] = []
    owners: list[int | None] = []
    for value, obj in tuples:
        owner = index_of.get(id(obj)) if obj is not None else None
        for character in value.replace("\r\n", "\n").replace("\r", "\n"):
            out_chars.append(character)
            owners.append(owner)
    return out_chars, owners


class _Builder:
    """Mirrors ``parsers.core._TextBuilder`` for PDFs, recording the owner of every char."""

    def __init__(self) -> None:
        self.parts: list[str] = []
        self.blocks: list[Block] = []
        self.owner_page = array("i")
        self.owner_char = array("i")
        self.length = 0
        self._last_char = ""

    def _raw(self, value: str, page: int, owner: int | None = None) -> None:
        if not value:
            return
        self.parts.append(value)
        self.length += len(value)
        self._last_char = value[-1]
        char = -1 if owner is None else owner
        for _ in value:
            self.owner_page.append(page)
            self.owner_char.append(char)

    def page_break(self) -> None:
        if self.length > 0 and self._last_char != "\n":
            self._raw("\n", -1)
        start = self.length
        self._raw("\f", -1)
        self.blocks.append(Block(start=start, end=self.length, kind="page_break", page=None))

    def page_paragraphs(self, chars: list[str], owners: list[int | None], page: int) -> None:
        text = "".join(chars)
        cursor = 0
        bounds: list[tuple[int, int]] = []
        for match in _PARAGRAPH_SEPARATOR_RE.finditer(text):
            bounds.append((cursor, match.start()))
            cursor = match.end()
        bounds.append((cursor, len(text)))
        for start, end in bounds:
            segment = text[start:end]
            left = start + (len(segment) - len(segment.lstrip()))
            right = start + len(segment.rstrip())
            if right <= left:
                continue
            if self.length > 0:
                self._raw("\n\n", page)
            block_start = self.length
            for position in range(left, right):
                self._raw(chars[position], page, owners[position])
            self.blocks.append(
                Block(start=block_start, end=self.length, kind="paragraph", page=page + 1)
            )
