"""Anonymize a DOCX in place: replace entity spans inside the original XML.

Only the text of the affected ``w:t`` nodes changes; styles, numbering, sections, headers,
images and every untouched part keep their original bytes. The token takes over the
formatting of the run where the entity starts.

Text that is not part of the reviewed document text (field codes, hyperlink targets,
image descriptions, chart labels, building blocks ...) is covered by a safety net: every
occurrence of an anonymized value found there is replaced with the same token.

Before the bytes are returned the result is re-read and verified; any remaining original
value outside what the user deliberately left visible aborts the export.
"""

from __future__ import annotations

import io
import re
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from urllib.parse import quote, unquote

from lxml import etree

from anonymizer_engine.anonymize.models import OffsetMapEntry
from anonymizer_engine.parsers.exceptions import ParserError
from anonymizer_engine.wordml.package import DocxPackage, qn
from anonymizer_engine.wordml.sanitize import sanitize
from anonymizer_engine.wordml.textmap import TextMap, build_text_map

_XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
_MIN_NET_VALUE_LENGTH = 3
_TOKEN_RE = re.compile(r"\[[A-ZĄĆĘŁŃÓŚŹŻ]+(?:_[A-ZĄĆĘŁŃÓŚŹŻ]+)*_\d+\]")
# Attributes that carry human-readable text (alt text, tooltips, field instructions,
# content-control titles). Structural attributes (sizes, ids, styles) are never touched.
_TEXT_ATTRIBUTES: dict[str, tuple[str, ...]] = {
    "docPr": ("descr", "title", "name"),
    "cNvPr": ("descr", "title", "name"),
    "hyperlink": (qn("w:tooltip"),),
    "fldSimple": (qn("w:instr"),),
    "alias": (qn("w:val"),),
    "tag": (qn("w:val"),),
    "shape": ("alt", "title"),
    "textpath": ("string",),
}
_TEXT_LOCAL_NAMES = {"t", "instrText", "delText"}
# Verification also looks at numeric chart values and document properties: a sensitive
# value there cannot be rewritten safely, so it must stop the export instead.
_REPORTED_LOCAL_NAMES = {
    "v",
    "lpstr",
    "creator",
    "lastModifiedBy",
    "title",
    "subject",
    "keywords",
    "description",
    "category",
    "Company",
    "Manager",
}


class DocxExportError(ParserError):
    """The DOCX could not be anonymized in place without risking a leak."""


@dataclass(frozen=True)
class Replacement:
    start: int
    end: int
    token: str


@dataclass(frozen=True)
class InPlaceResult:
    content: bytes
    notices: list[str]


def load(data: bytes) -> tuple[DocxPackage, TextMap, list[str]]:
    """Open ``data``, sanitize it in memory and build its text map."""
    package = DocxPackage(data)
    notices = sanitize(package)
    text_map = build_text_map(package)
    return package, text_map, notices


def anonymize_docx_in_place(
    data: bytes,
    offset_map: Sequence[OffsetMapEntry],
    anonymized_text: str,
) -> InPlaceResult:
    package, text_map, notices = load(data)
    replacements = _validated_replacements(text_map.text, offset_map, anonymized_text)
    sensitive = _SensitiveValues(text_map.text, replacements)

    crossed_separator = _apply_replacements(package, text_map, replacements)
    _apply_safety_net(package, text_map, sensitive)
    content = package.to_bytes()

    _verify(content, anonymized_text, sensitive, exact=not crossed_separator)
    return InPlaceResult(content=content, notices=notices)


# ------------------------------------------------------------ validation
def _validated_replacements(
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
        if replacement.start < cursor or replacement.end > len(text):
            raise DocxExportError("Replacement spans overlap or exceed the document text.")
        if replacement.end <= replacement.start:
            raise DocxExportError("Replacement span is empty.")
        parts.append(text[cursor : replacement.start])
        parts.append(replacement.token)
        cursor = replacement.end
    parts.append(text[cursor:])
    if "".join(parts) != anonymized_text:
        raise DocxExportError(
            "The source document does not match the anonymization result "
            "(the file was changed after it was imported)."
        )
    return replacements


# ----------------------------------------------------------- replacement
def _apply_replacements(
    package: DocxPackage,
    text_map: TextMap,
    replacements: Iterable[Replacement],
) -> bool:
    """Write tokens into the XML. Returns True when a span crossed a paragraph/cell boundary."""
    edits: dict[int, list[tuple[int, int, str]]] = {}
    nodes: dict[int, etree._Element] = {}
    removed_specials: list[etree._Element] = []
    crossed = False

    for replacement in replacements:
        pieces = text_map.pieces_in(replacement.start, replacement.end)
        anchor = next((piece for piece in pieces if piece.kind == "text"), None)
        if anchor is None:
            raise DocxExportError("An anonymized span has no editable text in the document.")
        for piece in pieces:
            lo = max(replacement.start, piece.start)
            hi = min(replacement.end, piece.end)
            if piece.kind == "virtual":
                crossed = True
                continue
            if piece.kind == "special":
                removed_specials.append(piece.node)
                package.mark_dirty(piece.part)
                continue
            node_lo = piece.node_start + (lo - piece.start)
            node_hi = piece.node_start + (hi - piece.start)
            value = replacement.token if piece is anchor else ""
            edits.setdefault(id(piece.node), []).append((node_lo, node_hi, value))
            nodes[id(piece.node)] = piece.node
            package.mark_dirty(piece.part)

    for key, node_edits in edits.items():
        node = nodes[key]
        value = node.text or ""
        for lo, hi, token in sorted(node_edits, reverse=True):
            value = value[:lo] + token + value[hi:]
        _set_text(node, value)

    for special in removed_specials:
        parent = special.getparent()
        if parent is not None:
            parent.remove(special)
    return crossed


def _set_text(node: etree._Element, value: str) -> None:
    node.text = value
    if node.tag == qn("w:t"):
        node.set(_XML_SPACE, "preserve")


# ------------------------------------------------------------ safety net
class _SensitiveValues:
    """The original values that were anonymized, matched as whole words, case-insensitively."""

    def __init__(self, text: str, replacements: Sequence[Replacement]) -> None:
        tokens: dict[str, str] = {}
        for replacement in replacements:
            value = _normalize(text[replacement.start : replacement.end])
            if len(value) >= _MIN_NET_VALUE_LENGTH:
                tokens.setdefault(value.casefold(), replacement.token)
        self.tokens = tokens
        self.token_counts = Counter(replacement.token for replacement in replacements)
        if tokens:
            alternatives = sorted(tokens, key=len, reverse=True)
            body = "|".join(_value_pattern(value) for value in alternatives)
            self.pattern: re.Pattern[str] | None = re.compile(
                rf"(?<!\w)(?:{body})(?!\w)", re.IGNORECASE
            )
        else:
            self.pattern = None

    def find(self, value: str) -> list[str]:
        if self.pattern is None or not value:
            return []
        return [match.group(0) for match in self.pattern.finditer(value)]

    def replace(self, value: str) -> str:
        if self.pattern is None or not value:
            return value
        return self.pattern.sub(lambda match: self.token_for(match.group(0)), value)

    def token_for(self, value: str) -> str:
        return self.tokens[_normalize(value).casefold()]


def _normalize(value: str) -> str:
    return " ".join(value.split())


def _value_pattern(value: str) -> str:
    return r"\s+".join(re.escape(word) for word in value.split(" "))


def _apply_safety_net(package: DocxPackage, text_map: TextMap, sensitive: _SensitiveValues) -> None:
    if sensitive.pattern is None:
        return
    walked = text_map.walked_text_nodes()
    for name in package.part_names():
        if name.endswith(".rels"):
            _net_relationships(package, name, sensitive)
            continue
        if not package.is_xml_part(name):
            continue
        root = package.xml(name)
        changed = False
        for container in _unwalked_text_containers(root, walked):
            changed |= _replace_in_nodes(container, sensitive)
        for element, attribute in _text_attributes(root):
            value = element.get(attribute)
            replaced = sensitive.replace(value)
            if replaced != value:
                element.set(attribute, replaced)
                changed = True
        if changed:
            package.mark_dirty(name)


def _net_relationships(package: DocxPackage, name: str, sensitive: _SensitiveValues) -> None:
    root = package.xml(name)
    changed = False
    for relationship in root.iter(qn("rel:Relationship")):
        if relationship.get("TargetMode") != "External":
            continue
        target = relationship.get("Target", "")
        decoded = unquote(target)
        if not sensitive.find(decoded):
            continue
        relationship.set("Target", quote(sensitive.replace(decoded), safe=":/?#@!$&'()*+,;=%~-._"))
        changed = True
    if changed:
        package.mark_dirty(name)


def _replace_in_nodes(nodes: list[etree._Element], sensitive: _SensitiveValues) -> bool:
    """Replace values in text split across several nodes (e.g. one field code in many runs)."""
    joined = "".join(node.text or "" for node in nodes)
    if not sensitive.find(joined):
        return False
    replaced = sensitive.replace(joined)
    _set_text(nodes[0], replaced)
    for node in nodes[1:]:
        _set_text(node, "")
    return True


def _unwalked_text_containers(
    root: etree._Element,
    walked: set[int],
    leaf_filter: Callable[[etree._Element], bool] | None = None,
) -> list[list[etree._Element]]:
    """Groups of text nodes that form one logical string outside the reviewed text."""
    containers: list[list[etree._Element]] = []
    containers.extend(_field_instructions(root))

    grouped: set[int] = {id(node) for group in containers for node in group}
    for paragraph in root.iter(qn("w:p"), qn("a:p")):
        nodes = [
            node
            for node in _own_text_nodes(paragraph)
            if id(node) not in walked and id(node) not in grouped
        ]
        if nodes:
            containers.append(nodes)
            grouped.update(id(node) for node in nodes)

    for node in root.iter():
        if not isinstance(node.tag, str) or id(node) in walked or id(node) in grouped:
            continue
        if (
            node.text
            and node.text.strip()
            and len(node) == 0
            and (leaf_filter or _is_free_text)(node)
        ):
            containers.append([node])
    return containers


def _is_free_text(node: etree._Element) -> bool:
    """Leaf elements whose content is prose that may be rewritten with a token.

    Numeric leaves (positions, sizes, chart number caches) are excluded: rewriting them
    would corrupt the file. A value found there is still reported by verification.
    """
    name = etree.QName(node).localname
    if name in {"t", "instrText", "delText"}:
        return True
    if name == "v":
        return _has_ancestor(node, {"strCache", "strLit", "rich", "tx"}) and not _has_ancestor(
            node, {"numCache", "numLit"}
        )
    return False


def _is_reported_text(node: etree._Element) -> bool:
    """Leaf elements checked by verification (a superset of :func:`_is_free_text`)."""
    return etree.QName(node).localname in _REPORTED_LOCAL_NAMES or _is_free_text(node)


def _has_ancestor(node: etree._Element, names: set[str]) -> bool:
    ancestor = node.getparent()
    while ancestor is not None:
        if isinstance(ancestor.tag, str) and etree.QName(ancestor).localname in names:
            return True
        ancestor = ancestor.getparent()
    return False


def _own_text_nodes(paragraph: etree._Element) -> list[etree._Element]:
    nodes: list[etree._Element] = []
    paragraph_tag = paragraph.tag
    for node in paragraph.iter():
        if node is paragraph or not isinstance(node.tag, str):
            continue
        if etree.QName(node).localname not in _TEXT_LOCAL_NAMES:
            continue
        ancestor = node.getparent()
        while ancestor is not None and ancestor is not paragraph and ancestor.tag != paragraph_tag:
            ancestor = ancestor.getparent()
        if ancestor is paragraph:
            nodes.append(node)
    return nodes


def _field_instructions(root: etree._Element) -> list[list[etree._Element]]:
    """Instruction text of complex fields, one group per field (nested fields supported)."""
    groups: list[list[etree._Element]] = []
    stack: list[list[etree._Element]] = []
    for node in root.iter(qn("w:fldChar"), qn("w:instrText")):
        if node.tag == qn("w:instrText"):
            if stack:
                stack[-1].append(node)
            continue
        kind = node.get(qn("w:fldCharType"))
        if kind == "begin":
            stack.append([])
        elif kind in {"separate", "end"} and stack:
            # The instruction ends at "separate" (or at "end" when there is no result).
            group = stack.pop()
            if group:
                groups.append(group)
            if kind == "separate":
                stack.append([])
    return groups


def _text_attributes(root: etree._Element) -> list[tuple[etree._Element, str]]:
    found: list[tuple[etree._Element, str]] = []
    for element in root.iter():
        if not isinstance(element.tag, str):
            continue
        attributes = _TEXT_ATTRIBUTES.get(etree.QName(element).localname)
        if not attributes:
            continue
        for attribute in attributes:
            if element.get(attribute):
                found.append((element, attribute))
    return found


# ----------------------------------------------------------- verification
def _verify(
    content: bytes,
    anonymized_text: str,
    sensitive: _SensitiveValues,
    *,
    exact: bool,
) -> None:
    package, text_map, _notices = load(content)
    text = text_map.text

    if exact and text != anonymized_text:
        raise DocxExportError(
            "Verification failed: the exported document text differs from the result."
        )
    if Counter(_TOKEN_RE.findall(text)) != Counter(_TOKEN_RE.findall(anonymized_text)):
        raise DocxExportError(
            "Verification failed: anonymization tokens are missing in the document."
        )
    expected = Counter(value.casefold() for value in sensitive.find(anonymized_text))
    actual = Counter(value.casefold() for value in sensitive.find(text))
    if any(count > expected[value] for value, count in actual.items()):
        raise DocxExportError(
            "Verification failed: an anonymized value is still in the document text."
        )

    leaks = _remaining_values_outside_text(package, text_map, sensitive)
    if leaks:
        locations = ", ".join(sorted(leaks))
        raise DocxExportError(
            "Verification failed: anonymized values remain outside the document text "
            f"({locations})."
        )

    from docx import Document

    try:
        Document(io.BytesIO(content))
    except Exception as exc:  # pragma: no cover - defensive, lxml output is well-formed
        raise DocxExportError("Verification failed: the exported DOCX cannot be opened.") from exc


def _remaining_values_outside_text(
    package: DocxPackage,
    text_map: TextMap,
    sensitive: _SensitiveValues,
) -> set[str]:
    if sensitive.pattern is None:
        return set()
    walked = text_map.walked_text_nodes()
    leaks: set[str] = set()
    for name in package.part_names():
        if name.endswith(".rels"):
            for relationship in package.xml(name).iter(qn("rel:Relationship")):
                if relationship.get("TargetMode") == "External" and sensitive.find(
                    unquote(relationship.get("Target", ""))
                ):
                    leaks.add(f"{name} (link)")
            continue
        if not package.is_xml_part(name):
            continue
        root = package.xml(name)
        for container in _unwalked_text_containers(root, walked, _is_reported_text):
            if sensitive.find("".join(node.text or "" for node in container)):
                leaks.add(name)
        for element, attribute in _text_attributes(root):
            if sensitive.find(element.get(attribute)):
                leaks.add(f"{name} (attribute)")
    return leaks
