"""Read and write a DOCX (OPC/ZIP) package while keeping untouched parts byte-identical."""

from __future__ import annotations

import io
import posixpath
import zipfile
from dataclasses import dataclass, field

from lxml import etree

from anonymizer_engine.parsers.exceptions import CorruptedFile

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "v": "urn:schemas-microsoft-com:vml",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "dc": "http://purl.org/dc/elements/1.1/",
    "ep": "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
    "vt": "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes",
}

REL_OFFICE_DOCUMENT = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
)
_REL_TYPE_PREFIXES = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/",
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/",
    "http://schemas.microsoft.com/office/2011/relationships/",
    "http://schemas.microsoft.com/office/2016/09/relationships/",
    "http://schemas.microsoft.com/office/2018/08/relationships/",
)

_XML_PARSER = etree.XMLParser(
    resolve_entities=False,
    no_network=True,
    huge_tree=False,
    remove_blank_text=False,
)


def qn(tag: str) -> str:
    """Expand ``"w:t"`` into Clark notation ``"{namespace}t"``."""
    prefix, local = tag.split(":", 1)
    return f"{{{NS[prefix]}}}{local}"


def rel_type_name(rel_type: str) -> str:
    """Short name of a relationship type URI, e.g. ``"header"`` or ``"comments"``."""
    for prefix in _REL_TYPE_PREFIXES:
        if rel_type.startswith(prefix):
            return rel_type[len(prefix) :]
    return rel_type.rsplit("/", 1)[-1]


@dataclass
class Relationship:
    rel_id: str
    rel_type: str
    target: str
    external: bool
    element: etree._Element = field(repr=False)


class DocxPackage:
    """In-memory DOCX package.

    XML parts are parsed lazily; only parts marked dirty are re-serialized on save, every
    other member is written back with its original bytes and ZIP metadata.
    """

    def __init__(self, data: bytes) -> None:
        try:
            archive = zipfile.ZipFile(io.BytesIO(data))
            self._infos = archive.infolist()
            self._raw = {info.filename: archive.read(info.filename) for info in self._infos}
        except (zipfile.BadZipFile, KeyError, OSError, EOFError) as exc:
            raise CorruptedFile("DOCX file is not a valid ZIP archive.") from exc
        self._trees: dict[str, etree._Element] = {}
        self._dirty: set[str] = set()
        self._removed: set[str] = set()
        if "[Content_Types].xml" not in self._raw:
            raise CorruptedFile("DOCX package has no [Content_Types].xml.")
        self.main_part = self._find_main_part()

    # ----------------------------------------------------------------- parts
    def part_names(self) -> list[str]:
        return [info.filename for info in self._infos if info.filename not in self._removed]

    def has_part(self, name: str) -> bool:
        return name in self._raw and name not in self._removed

    def raw(self, name: str) -> bytes:
        return self._raw[name]

    def xml(self, name: str) -> etree._Element:
        if name not in self._trees:
            try:
                self._trees[name] = etree.fromstring(self._raw[name], _XML_PARSER)
            except etree.XMLSyntaxError as exc:
                raise CorruptedFile(f"DOCX part {name} is not well-formed XML.") from exc
        return self._trees[name]

    def is_xml_part(self, name: str) -> bool:
        lowered = name.casefold()
        return lowered.endswith(".xml") or lowered.endswith(".rels")

    def mark_dirty(self, name: str) -> None:
        self._dirty.add(name)

    def remove_part(self, name: str) -> None:
        """Remove a part together with every relationship and content-type override to it."""
        if not self.has_part(name):
            return
        self._removed.add(name)
        rels_name = rels_part_name(name)
        if self.has_part(rels_name):
            self._removed.add(rels_name)
        for source in self.part_names():
            if not source.endswith(".rels"):
                continue
            owner = source_part_of_rels(source)
            for rel in self.relationships(owner):
                if not rel.external and resolve_target(owner, rel.target) == name:
                    self.remove_relationship(owner, rel.rel_id)
        types = self.xml("[Content_Types].xml")
        for override in types.findall(qn("ct:Override")):
            if override.get("PartName", "").lstrip("/") == name:
                types.remove(override)
                self.mark_dirty("[Content_Types].xml")

    # ------------------------------------------------------- relationships
    def relationships(self, owner: str) -> list[Relationship]:
        name = rels_part_name(owner)
        if not self.has_part(name):
            return []
        result: list[Relationship] = []
        for element in self.xml(name).findall(qn("rel:Relationship")):
            result.append(
                Relationship(
                    rel_id=element.get("Id", ""),
                    rel_type=element.get("Type", ""),
                    target=element.get("Target", ""),
                    external=element.get("TargetMode") == "External",
                    element=element,
                )
            )
        return result

    def related_part(self, owner: str, rel_id: str) -> str | None:
        for rel in self.relationships(owner):
            if rel.rel_id == rel_id and not rel.external:
                target = resolve_target(owner, rel.target)
                return target if self.has_part(target) else None
        return None

    def parts_by_rel_type(self, owner: str, type_name: str) -> list[str]:
        names: list[str] = []
        for rel in self.relationships(owner):
            if rel.external or rel_type_name(rel.rel_type) != type_name:
                continue
            target = resolve_target(owner, rel.target)
            if self.has_part(target) and target not in names:
                names.append(target)
        return names

    def remove_relationship(self, owner: str, rel_id: str) -> None:
        name = rels_part_name(owner)
        if not self.has_part(name):
            return
        root = self.xml(name)
        for element in root.findall(qn("rel:Relationship")):
            if element.get("Id") == rel_id:
                root.remove(element)
                self.mark_dirty(name)

    # ---------------------------------------------------------------- save
    def to_bytes(self) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for info in self._infos:
                name = info.filename
                if name in self._removed:
                    continue
                if name in self._dirty:
                    payload = etree.tostring(
                        self._trees[name],
                        xml_declaration=True,
                        encoding="UTF-8",
                        standalone=True,
                    )
                else:
                    payload = self._raw[name]
                archive.writestr(_copy_info(info), payload)
        return buffer.getvalue()

    def _find_main_part(self) -> str:
        for rel in self.relationships(""):
            if rel.rel_type == REL_OFFICE_DOCUMENT and not rel.external:
                target = resolve_target("", rel.target)
                if self.has_part(target):
                    return target
        if self.has_part("word/document.xml"):
            return "word/document.xml"
        raise CorruptedFile("DOCX package has no main document part.")


def rels_part_name(owner: str) -> str:
    """``word/document.xml`` -> ``word/_rels/document.xml.rels``; ``""`` -> ``_rels/.rels``."""
    directory, filename = posixpath.split(owner)
    return posixpath.join(directory, "_rels", f"{filename}.rels")


def source_part_of_rels(rels_name: str) -> str:
    directory, filename = posixpath.split(rels_name)
    owner_dir = posixpath.dirname(directory)
    return posixpath.join(owner_dir, filename[: -len(".rels")])


def resolve_target(owner: str, target: str) -> str:
    if target.startswith("/"):
        return posixpath.normpath(target.lstrip("/"))
    base = posixpath.dirname(owner)
    return posixpath.normpath(posixpath.join(base, target))


def _copy_info(info: zipfile.ZipInfo) -> zipfile.ZipInfo:
    copy = zipfile.ZipInfo(info.filename, date_time=info.date_time)
    copy.compress_type = zipfile.ZIP_DEFLATED
    copy.external_attr = info.external_attr
    copy.create_system = info.create_system
    return copy
