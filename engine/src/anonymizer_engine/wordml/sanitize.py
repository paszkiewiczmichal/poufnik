"""Remove DOCX content that must never survive anonymization untouched.

Applied in memory both when a DOCX is parsed and when it is exported, so the text the
user reviews is exactly the text present in the exported file:

* tracked changes are accepted (deleted text is dropped, inserted text becomes plain),
* comments are removed together with their parts and the people list,
* content controls bound to custom XML data are unbound (Word would otherwise refill
  them with the original values from the data store when the file is opened),
* custom XML data stores (SharePoint properties, former content-control data) are
  removed, as are hidden descriptions that are not part of the visible text (hyperlink
  screen tips, image alt texts) - they often repeat names in other grammatical forms,
* embedded foreign documents (``w:altChunk``: HTML/RTF/DOCX pasted as a whole) are
  removed - their text is never reviewed, so it cannot stay in the output,
* legacy VML copies of text boxes (``mc:Fallback``) are dropped – the DrawingML copy in
  ``mc:Choice`` is what gets anonymized,
* author/company metadata, custom properties, the page thumbnail, the attached template
  path, document variables and mail-merge data sources are cleared.
"""

from __future__ import annotations

from lxml import etree

from anonymizer_engine.wordml.package import NS, DocxPackage, qn, rel_type_name, resolve_target

NOTICE_TRACKED_CHANGES = "tracked_changes_accepted"
NOTICE_COMMENTS = "comments_removed"
NOTICE_METADATA = "metadata_cleared"
NOTICE_DATA_BINDINGS = "content_controls_unbound"
NOTICE_MAIL_MERGE = "mail_merge_removed"
NOTICE_CUSTOM_XML = "custom_xml_removed"
NOTICE_DESCRIPTIONS = "descriptions_cleared"
NOTICE_EMBEDDED_DOCUMENT = "embedded_document_removed"
NOTICE_MEDIA = "images_or_objects_present"

_W = NS["w"]
_REMOVED_CONTENT = {qn("w:del"), qn("w:moveFrom")}
_UNWRAPPED_CONTENT = {qn("w:ins"), qn("w:moveTo")}
_PROPERTY_CHANGES = {
    qn(f"w:{name}")
    for name in (
        "rPrChange",
        "pPrChange",
        "sectPrChange",
        "tblPrChange",
        "tblPrExChange",
        "tcPrChange",
        "trPrChange",
        "tblGridChange",
        "numberingChange",
        "cellIns",
        "cellDel",
        "cellMerge",
        "moveFromRangeStart",
        "moveFromRangeEnd",
        "moveToRangeStart",
        "moveToRangeEnd",
        "customXmlInsRangeStart",
        "customXmlInsRangeEnd",
        "customXmlDelRangeStart",
        "customXmlDelRangeEnd",
        "customXmlMoveFromRangeStart",
        "customXmlMoveFromRangeEnd",
        "customXmlMoveToRangeStart",
        "customXmlMoveToRangeEnd",
    )
}
_COMMENT_MARKERS = {qn("w:commentRangeStart"), qn("w:commentRangeEnd")}
_COMMENT_PART_TYPES = (
    "comments",
    "commentsExtended",
    "commentsIds",
    "commentsExtensible",
    "people",
)
_CORE_CLEARED = (
    "dc:creator",
    "cp:lastModifiedBy",
    "dc:title",
    "dc:subject",
    "cp:keywords",
    "dc:description",
    "cp:category",
    "cp:contentStatus",
    "cp:identifier",
)
_APP_CLEARED = ("ep:Company", "ep:Manager", "ep:HyperlinkBase")


def story_parts(package: DocxPackage) -> list[str]:
    """Parts holding WordprocessingML content: body, headers, footers, foot- and endnotes."""
    main = package.main_part
    parts = [main]
    for type_name in ("header", "footer", "footnotes", "endnotes"):
        for name in package.parts_by_rel_type(main, type_name):
            if name not in parts:
                parts.append(name)
    return parts


def sanitize(package: DocxPackage) -> list[str]:
    """Sanitize ``package`` in place and return notice codes describing what was changed."""
    notices: list[str] = []
    stories = story_parts(package)
    formatting_parts = [
        name
        for type_name in ("styles", "numbering")
        for name in package.parts_by_rel_type(package.main_part, type_name)
    ]

    if _accept_revisions(package, stories, formatting_parts):
        notices.append(NOTICE_TRACKED_CHANGES)
    if _remove_comments(package, stories):
        notices.append(NOTICE_COMMENTS)
    if _unbind_content_controls(package, stories):
        notices.append(NOTICE_DATA_BINDINGS)
    if _remove_embedded_documents(package, stories):
        notices.append(NOTICE_EMBEDDED_DOCUMENT)
    if _remove_custom_xml(package):
        notices.append(NOTICE_CUSTOM_XML)
    if _clear_descriptions(package, stories):
        notices.append(NOTICE_DESCRIPTIONS)
    _drop_text_fallbacks(package, stories)
    if _remove_mail_merge(package):
        notices.append(NOTICE_MAIL_MERGE)
    if _scrub_metadata(package):
        notices.append(NOTICE_METADATA)
    if any(_is_media(name) for name in package.part_names()):
        # Pixels and embedded files are not rewritten; the user has to check them.
        notices.append(NOTICE_MEDIA)
    return notices


def _is_media(name: str) -> bool:
    lowered = name.casefold()
    return lowered.startswith(("word/media/", "word/embeddings/"))


# --------------------------------------------------------------- revisions
def _accept_revisions(package: DocxPackage, stories: list[str], formatting: list[str]) -> bool:
    changed = False
    for name in [*stories, *formatting]:
        root = package.xml(name)
        part_changed = False

        merged_paragraphs = [
            p
            for p in root.iter(qn("w:p"))
            if p.find(f"{qn('w:pPr')}/{qn('w:rPr')}/{qn('w:del')}") is not None
            or p.find(f"{qn('w:pPr')}/{qn('w:rPr')}/{qn('w:moveFrom')}") is not None
        ]
        deleted_rows = [
            tr
            for tr in root.iter(qn("w:tr"))
            if tr.find(f"{qn('w:trPr')}/{qn('w:del')}") is not None
        ]

        for element in list(root.iter(*_REMOVED_CONTENT)):
            parent = element.getparent()
            if parent is None:
                continue
            if _is_property_marker(parent):
                parent.remove(element)
            else:
                _remove_preserving_tail(element)
            part_changed = True

        for element in list(root.iter(*_UNWRAPPED_CONTENT)):
            parent = element.getparent()
            if parent is None:
                continue
            if _is_property_marker(parent):
                parent.remove(element)
            else:
                _unwrap(element)
            part_changed = True

        for element in list(root.iter(*_PROPERTY_CHANGES)):
            parent = element.getparent()
            if parent is not None:
                parent.remove(element)
                part_changed = True

        for row in deleted_rows:
            parent = row.getparent()
            if parent is not None:
                parent.remove(row)
                part_changed = True

        for paragraph in merged_paragraphs:
            if paragraph.getparent() is not None:
                _merge_into_next_paragraph(paragraph)
                part_changed = True

        if part_changed:
            package.mark_dirty(name)
            changed = True
    return changed


def _is_property_marker(parent: etree._Element) -> bool:
    return etree.QName(parent).localname.endswith("Pr")


def _merge_into_next_paragraph(paragraph: etree._Element) -> None:
    """Accept a deleted paragraph mark: the paragraph's content joins the next paragraph."""
    following = paragraph.getnext()
    while following is not None and following.tag != qn("w:p"):
        if following.tag in {qn("w:tbl"), qn("w:sdt")}:
            following = None
            break
        following = following.getnext()
    if following is None:
        # Nothing to join with (last paragraph of a cell/story): keep the paragraph, the
        # deletion marker itself was already removed.
        return
    content = [child for child in paragraph if child.tag != qn("w:pPr")]
    insert_at = 1 if len(following) and following[0].tag == qn("w:pPr") else 0
    for offset, child in enumerate(content):
        following.insert(insert_at + offset, child)
    paragraph.getparent().remove(paragraph)


# ---------------------------------------------------------------- comments
def _remove_comments(package: DocxPackage, stories: list[str]) -> bool:
    changed = False
    for name in stories:
        root = package.xml(name)
        part_changed = False
        for marker in list(root.iter(*_COMMENT_MARKERS)):
            _remove_preserving_tail(marker)
            part_changed = True
        for reference in list(root.iter(qn("w:commentReference"))):
            run = reference.getparent()
            _remove_preserving_tail(reference)
            if run is not None and run.tag == qn("w:r") and _run_is_empty(run):
                _remove_preserving_tail(run)
            part_changed = True
        if part_changed:
            package.mark_dirty(name)
            changed = True

    for type_name in _COMMENT_PART_TYPES:
        for part in package.parts_by_rel_type(package.main_part, type_name):
            package.remove_part(part)
            changed = True
    return changed


def _run_is_empty(run: etree._Element) -> bool:
    return all(child.tag == qn("w:rPr") for child in run)


# -------------------------------------------------------- content controls
def _unbind_content_controls(package: DocxPackage, stories: list[str]) -> bool:
    changed = False
    for name in stories:
        root = package.xml(name)
        bindings = [
            element
            for element in root.iter()
            if isinstance(element.tag, str) and etree.QName(element).localname == "dataBinding"
        ]
        for binding in bindings:
            _remove_preserving_tail(binding)
        if bindings:
            package.mark_dirty(name)
            changed = True
    return changed


def _remove_embedded_documents(package: DocxPackage, stories: list[str]) -> bool:
    changed = False
    for name in stories:
        root = package.xml(name)
        chunks = list(root.iter(qn("w:altChunk")))
        for chunk in chunks:
            target = package.related_part(name, chunk.get(qn("r:id"), ""))
            _remove_preserving_tail(chunk)
            if target is not None:
                package.remove_part(target)
        if chunks:
            package.mark_dirty(name)
            changed = True
    return changed


def _remove_custom_xml(package: DocxPackage) -> bool:
    names = [
        name
        for name in package.part_names()
        if name.casefold().startswith("customxml/") and not name.endswith(".rels")
    ]
    for name in names:
        package.remove_part(name)
    return bool(names)


_DESCRIPTION_ATTRIBUTES = {
    "docPr": ("descr", "title"),
    "cNvPr": ("descr", "title"),
    "hyperlink": (qn("w:tooltip"),),
    "shape": ("alt", "title"),
}


def _clear_descriptions(package: DocxPackage, stories: list[str]) -> bool:
    changed = False
    for name in stories:
        root = package.xml(name)
        part_changed = False
        for element in root.iter():
            if not isinstance(element.tag, str):
                continue
            for attribute in _DESCRIPTION_ATTRIBUTES.get(etree.QName(element).localname, ()):
                if element.get(attribute):
                    del element.attrib[attribute]
                    part_changed = True
        if part_changed:
            package.mark_dirty(name)
            changed = True
    return changed


def _drop_text_fallbacks(package: DocxPackage, stories: list[str]) -> None:
    for name in stories:
        root = package.xml(name)
        part_changed = False
        for alternate in list(root.iter(qn("mc:AlternateContent"))):
            choice = alternate.find(qn("mc:Choice"))
            fallback = alternate.find(qn("mc:Fallback"))
            if choice is None or fallback is None:
                continue
            fallback_has_text = next(fallback.iter(qn("w:t")), None) is not None
            choice_has_text = next(choice.iter(qn("w:txbxContent")), None) is not None
            if fallback_has_text and choice_has_text:
                alternate.remove(fallback)
                part_changed = True
        if part_changed:
            package.mark_dirty(name)


# -------------------------------------------------------------- settings
def _remove_mail_merge(package: DocxPackage) -> bool:
    removed_mail_merge = False
    for settings in package.parts_by_rel_type(package.main_part, "settings"):
        root = package.xml(settings)
        part_changed = False
        for tag in ("w:attachedTemplate", "w:docVars", "w:mailMerge"):
            for element in list(root.iter(qn(tag))):
                for rel_id in _relationship_ids(element):
                    package.remove_relationship(settings, rel_id)
                _remove_preserving_tail(element)
                part_changed = True
                if tag == "w:mailMerge":
                    removed_mail_merge = True
        if part_changed:
            package.mark_dirty(settings)
    return removed_mail_merge


def _relationship_ids(element: etree._Element) -> list[str]:
    rel_id_attr = qn("r:id")
    return [
        node.get(rel_id_attr)
        for node in element.iter()
        if isinstance(node.tag, str) and node.get(rel_id_attr)
    ]


# -------------------------------------------------------------- metadata
def _scrub_metadata(package: DocxPackage) -> bool:
    changed = False
    for rel in package.relationships(""):
        if rel.external:
            continue
        target = resolve_target("", rel.target)
        if not package.has_part(target):
            continue
        kind = rel_type_name(rel.rel_type)
        if kind == "core-properties":
            changed |= _clear_elements(package, target, _CORE_CLEARED)
        elif kind == "extended-properties":
            changed |= _clear_elements(package, target, _APP_CLEARED)
            changed |= _clear_titles_of_parts(package, target)
        elif kind in {"custom-properties", "thumbnail"}:
            package.remove_part(target)
            changed = True
    return changed


def _clear_elements(package: DocxPackage, part: str, tags: tuple[str, ...]) -> bool:
    root = package.xml(part)
    changed = False
    for tag in tags:
        for element in root.iter(qn(tag)):
            if element.text or len(element):
                element.text = None
                for child in list(element):
                    element.remove(child)
                changed = True
    if changed:
        package.mark_dirty(part)
    return changed


def _clear_titles_of_parts(package: DocxPackage, part: str) -> bool:
    root = package.xml(part)
    changed = False
    for titles in root.iter(qn("ep:TitlesOfParts")):
        for value in titles.iter(qn("vt:lpstr")):
            if value.text:
                value.text = None
                changed = True
    if changed:
        package.mark_dirty(part)
    return changed


# ----------------------------------------------------------------- helpers
def _remove_preserving_tail(element: etree._Element) -> None:
    parent = element.getparent()
    if parent is None:
        return
    if element.tail:
        previous = element.getprevious()
        if previous is not None:
            previous.tail = (previous.tail or "") + element.tail
        else:
            parent.text = (parent.text or "") + element.tail
    parent.remove(element)


def _unwrap(element: etree._Element) -> None:
    parent = element.getparent()
    if parent is None:
        return
    index = parent.index(element)
    children = list(element)
    for offset, child in enumerate(children):
        parent.insert(index + offset, child)
    _remove_preserving_tail(element)
