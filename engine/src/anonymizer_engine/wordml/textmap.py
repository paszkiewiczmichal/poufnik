"""Extract canonical text from WordprocessingML and remember where every character lives.

The text layout follows the long-standing DOCX parser contract (headers, body, footers;
blocks separated by a blank line; table cells separated by tabs and rows by newlines)
and extends it with content python-docx never reported: foot/endnotes, text boxes,
content controls, simple fields and accepted tracked insertions.

Each character of the produced text is backed by a :class:`Piece`: a slice of a ``w:t``
node, a special element (``w:tab``, ``w:br`` ...) or a *virtual* separator inserted only
in the text. Replacing a text span therefore maps straight onto the original XML nodes.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field
from typing import Literal

from lxml import etree

from anonymizer_engine.parsers.exceptions import UnsupportedFormat
from anonymizer_engine.parsers.models import Block, BlockKind
from anonymizer_engine.wordml.package import DocxPackage, qn

PieceKind = Literal["text", "special", "virtual"]

_HEADER_TYPES = ("default", "first", "even")
_INLINE_CONTAINERS = {
    qn("w:hyperlink"),
    qn("w:ins"),
    qn("w:moveTo"),
    qn("w:smartTag"),
    qn("w:customXml"),
    qn("w:fldSimple"),
    qn("w:dir"),
    qn("w:bdo"),
}
_BLOCK_WRAPPERS = {qn("w:customXml")}
_SPECIAL_TEXT = {
    qn("w:tab"): "\t",
    qn("w:ptab"): "\t",
    qn("w:cr"): "\n",
    qn("w:noBreakHyphen"): "-",
}
_EMBEDDED_CONTENT = {qn("w:drawing"), qn("w:pict"), qn("w:object")}


@dataclass
class Piece:
    start: int
    end: int
    kind: PieceKind
    part: str = ""
    node: etree._Element | None = field(default=None, repr=False)
    node_start: int = 0


@dataclass
class _Atom:
    text: str
    kind: PieceKind
    part: str = ""
    node: etree._Element | None = None
    node_start: int = 0


@dataclass
class TextMap:
    text: str
    blocks: list[Block]
    pieces: list[Piece]
    story_parts: list[str]
    _starts: list[int] = field(default_factory=list, repr=False)

    def __post_init__(self) -> None:
        self._starts = [piece.start for piece in self.pieces]

    def pieces_in(self, start: int, end: int) -> list[Piece]:
        """Pieces overlapping ``[start, end)`` in text order."""
        index = max(bisect_right(self._starts, start) - 1, 0)
        result: list[Piece] = []
        while index < len(self.pieces) and self.pieces[index].start < end:
            piece = self.pieces[index]
            if piece.end > start:
                result.append(piece)
            index += 1
        return result

    def walked_text_nodes(self) -> set[int]:
        return {id(piece.node) for piece in self.pieces if piece.kind == "text"}


class _Builder:
    def __init__(self) -> None:
        self.parts: list[str] = []
        self.pieces: list[Piece] = []
        self.blocks: list[Block] = []
        self.length = 0

    def virtual(self, value: str) -> None:
        self._push(_Atom(value, "virtual"))

    def block(self, atoms: list[_Atom], kind: BlockKind, *, separate: bool = True) -> None:
        if not atoms:
            return
        if separate and self.length > 0:
            self.virtual("\n\n")
        start = self.length
        for atom in atoms:
            self._push(atom)
        self.blocks.append(Block(start=start, end=self.length, kind=kind, page=None))

    def _push(self, atom: _Atom) -> None:
        if not atom.text:
            return
        start = self.length
        self.parts.append(atom.text)
        self.length += len(atom.text)
        self.pieces.append(
            Piece(
                start=start,
                end=self.length,
                kind=atom.kind,
                part=atom.part,
                node=atom.node,
                node_start=atom.node_start,
            )
        )


class _Walker:
    def __init__(self, package: DocxPackage) -> None:
        self.package = package
        self.builder = _Builder()
        self.part = ""
        self._style_names = _paragraph_style_names(package)
        self._default_style = self._style_names.get("", "")

    # ---------------------------------------------------------- stories
    def walk(self) -> TextMap:
        main = self.package.main_part
        body = self.package.xml(main).find(qn("w:body"))
        if body is None:
            # Strict Open XML (purl.oclc.org namespaces) or not WordprocessingML at all:
            # reading nothing would silently leave every value in the file.
            raise UnsupportedFormat(
                "This DOCX uses an unsupported variant (e.g. Strict Open XML). "
                "Save it in Word as a standard Word document (.docx) and import it again."
            )
        sections = list(self.package.xml(main).iter(qn("w:sectPr")))
        seen: list[str] = []

        self._walk_section_stories(main, sections, "w:headerReference", seen)
        if body is not None:
            self.part = main
            self._blocks(body)
        self._walk_section_stories(main, sections, "w:footerReference", seen)

        for type_name in ("header", "footer"):
            for name in self.package.parts_by_rel_type(main, type_name):
                if name not in seen:
                    seen.append(name)
                    self._story(name)

        notes: list[str] = []
        for type_name, note_tag in (("footnotes", "w:footnote"), ("endnotes", "w:endnote")):
            for name in self.package.parts_by_rel_type(main, type_name):
                notes.append(name)
                self.part = name
                for note in self.package.xml(name).iter(qn(note_tag)):
                    if note.get(qn("w:type"), "normal") == "normal":
                        self._blocks(note)

        text = "".join(self.builder.parts)
        return TextMap(
            text=text,
            blocks=self.builder.blocks,
            pieces=self.builder.pieces,
            story_parts=[main, *seen, *notes],
        )

    def _walk_section_stories(
        self,
        main: str,
        sections: list[etree._Element],
        reference_tag: str,
        seen: list[str],
    ) -> None:
        for section in sections:
            for story_type in _HEADER_TYPES:
                for reference in section.findall(qn(reference_tag)):
                    if reference.get(qn("w:type"), "default") != story_type:
                        continue
                    name = self.package.related_part(main, reference.get(qn("r:id"), ""))
                    if name is None or name in seen:
                        continue
                    seen.append(name)
                    self._story(name)

    def _story(self, name: str) -> None:
        self.part = name
        self._blocks(self.package.xml(name))

    # ----------------------------------------------------------- blocks
    def _blocks(self, container: etree._Element) -> None:
        for child in container:
            tag = child.tag
            if tag == qn("w:p"):
                boxes: list[etree._Element] = []
                atoms = _strip(self._paragraph(child, boxes))
                self.builder.block(atoms, self._paragraph_kind(child))
                self._text_boxes(boxes)
            elif tag == qn("w:tbl"):
                self._table(child)
            elif tag == qn("w:sdt"):
                content = child.find(qn("w:sdtContent"))
                if content is not None:
                    self._blocks(content)
            elif tag in _BLOCK_WRAPPERS:
                self._blocks(child)
            elif tag == qn("mc:AlternateContent"):
                choice = child.find(qn("mc:Choice"))
                if choice is not None:
                    self._blocks(choice)

    def _text_boxes(self, boxes: list[etree._Element]) -> None:
        for box in boxes:
            self._blocks(box)

    def _table(self, table: etree._Element) -> None:
        boxes: list[etree._Element] = []
        started = False
        for row in _children(table, qn("w:tr")):
            cells = [_strip(self._cell(cell, boxes)) for cell in _children(row, qn("w:tc"))]
            if not any(cells):
                continue
            if not started:
                if self.builder.length > 0:
                    self.builder.virtual("\n\n")
                started = True
            else:
                self.builder.virtual("\n")
            for index, cell_atoms in enumerate(cells):
                if index > 0:
                    self.builder.virtual("\t")
                self.builder.block(cell_atoms, "table_cell", separate=False)
        self._text_boxes(boxes)

    def _cell(self, cell: etree._Element, boxes: list[etree._Element]) -> list[_Atom]:
        """Cell text: paragraphs joined by newlines, nested tables flattened row by row."""
        lines: list[list[_Atom]] = []
        self._cell_lines(cell, boxes, lines)
        atoms: list[_Atom] = []
        for index, line in enumerate(lines):
            if index > 0:
                atoms.append(_Atom("\n", "virtual"))
            atoms.extend(line)
        return atoms

    def _cell_lines(
        self,
        container: etree._Element,
        boxes: list[etree._Element],
        lines: list[list[_Atom]],
    ) -> None:
        for child in container:
            tag = child.tag
            if tag == qn("w:p"):
                lines.append(self._paragraph(child, boxes))
            elif tag == qn("w:tbl"):
                for row in _children(child, qn("w:tr")):
                    row_atoms: list[_Atom] = []
                    for index, cell in enumerate(_children(row, qn("w:tc"))):
                        if index > 0:
                            row_atoms.append(_Atom("\t", "virtual"))
                        row_atoms.extend(_strip(self._cell(cell, boxes)))
                    lines.append(row_atoms)
            elif tag == qn("w:sdt"):
                content = child.find(qn("w:sdtContent"))
                if content is not None:
                    self._cell_lines(content, boxes, lines)
            elif tag in _BLOCK_WRAPPERS:
                self._cell_lines(child, boxes, lines)

    # ------------------------------------------------------- paragraphs
    def _paragraph(self, paragraph: etree._Element, boxes: list[etree._Element]) -> list[_Atom]:
        atoms: list[_Atom] = []
        self._inline(paragraph, atoms, boxes)
        return atoms

    def _inline(
        self,
        container: etree._Element,
        atoms: list[_Atom],
        boxes: list[etree._Element],
    ) -> None:
        for child in container:
            tag = child.tag
            if tag == qn("w:r"):
                self._run(child, atoms, boxes)
            elif tag in _INLINE_CONTAINERS:
                self._inline(child, atoms, boxes)
            elif tag == qn("w:sdt"):
                content = child.find(qn("w:sdtContent"))
                if content is not None:
                    self._inline(content, atoms, boxes)
            elif tag == qn("mc:AlternateContent"):
                choice = child.find(qn("mc:Choice"))
                if choice is not None:
                    self._inline(choice, atoms, boxes)

    def _run(self, run: etree._Element, atoms: list[_Atom], boxes: list[etree._Element]) -> None:
        for child in run:
            tag = child.tag
            if tag == qn("w:t"):
                if child.text:
                    atoms.append(_Atom(child.text, "text", self.part, child))
            elif tag in _SPECIAL_TEXT:
                atoms.append(_Atom(_SPECIAL_TEXT[tag], "special", self.part, child))
            elif tag == qn("w:br"):
                if child.get(qn("w:type"), "textWrapping") == "textWrapping":
                    atoms.append(_Atom("\n", "special", self.part, child))
            elif tag in _EMBEDDED_CONTENT:
                boxes.extend(_outer_text_boxes(child))
            elif tag == qn("mc:AlternateContent"):
                choice = child.find(qn("mc:Choice"))
                if choice is not None:
                    boxes.extend(_outer_text_boxes(choice))

    def _paragraph_kind(self, paragraph: etree._Element) -> BlockKind:
        style_id = paragraph.find(f"{qn('w:pPr')}/{qn('w:pStyle')}")
        if style_id is None:
            name = self._default_style
        else:
            name = self._style_names.get(style_id.get(qn("w:val"), ""), "")
        if name == "title" or name.startswith("heading"):
            return "heading"
        return "paragraph"


def build_text_map(package: DocxPackage) -> TextMap:
    return _Walker(package).walk()


def _children(element: etree._Element, tag: str) -> list[etree._Element]:
    """Direct ``tag`` children, looking through content-control and custom-XML wrappers."""
    result: list[etree._Element] = []
    for child in element:
        if child.tag == tag:
            result.append(child)
        elif child.tag == qn("w:sdt"):
            content = child.find(qn("w:sdtContent"))
            if content is not None:
                result.extend(_children(content, tag))
        elif child.tag in _BLOCK_WRAPPERS:
            result.extend(_children(child, tag))
    return result


def _outer_text_boxes(element: etree._Element) -> list[etree._Element]:
    tag = qn("w:txbxContent")
    boxes: list[etree._Element] = []
    for box in element.iter(tag):
        ancestor = box.getparent()
        nested = False
        while ancestor is not None and ancestor is not element:
            if ancestor.tag == tag:
                nested = True
                break
            ancestor = ancestor.getparent()
        if not nested:
            boxes.append(box)
    return boxes


def _strip(atoms: list[_Atom]) -> list[_Atom]:
    """Trim leading/trailing whitespace exactly like ``str.strip`` on the joined text."""
    text = "".join(atom.text for atom in atoms)
    left = len(text) - len(text.lstrip())
    right = len(text.rstrip())
    if right <= left:
        return []
    result: list[_Atom] = []
    cursor = 0
    for atom in atoms:
        atom_start, atom_end = cursor, cursor + len(atom.text)
        cursor = atom_end
        lo, hi = max(atom_start, left), min(atom_end, right)
        if hi <= lo:
            continue
        cut_start = lo - atom_start
        result.append(
            _Atom(
                text=atom.text[cut_start : hi - atom_start],
                kind=atom.kind,
                part=atom.part,
                node=atom.node,
                node_start=atom.node_start + cut_start,
            )
        )
    return result


def _paragraph_style_names(package: DocxPackage) -> dict[str, str]:
    """Map paragraph style ids to their casefolded names; ``""`` -> default paragraph style."""
    names: dict[str, str] = {}
    for part in package.parts_by_rel_type(package.main_part, "styles"):
        for style in package.xml(part).iter(qn("w:style")):
            if style.get(qn("w:type")) != "paragraph":
                continue
            name_element = style.find(qn("w:name"))
            name = (
                name_element.get(qn("w:val"), "") if name_element is not None else ""
            ).casefold()
            style_id = style.get(qn("w:styleId"), "")
            names[style_id] = name
            if style.get(qn("w:default")) in {"1", "true", "on"}:
                names[""] = name
    return names
