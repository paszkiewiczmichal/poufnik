"""Remove PDF content that must never survive anonymization untouched.

Applied in memory both when a PDF is parsed and when it is exported, so the text the user
reviews is exactly the text the export redacts:

* filled form fields are flattened into the page content (their values become ordinary
  page text, which is reviewed and anonymized); every remaining annotation - comments,
  links (``mailto:`` targets), attachments - is removed together with the form itself,
* document metadata (Info dictionary, XMP), bookmarks, embedded files, JavaScript and
  automatic actions are removed,
* hidden replacement texts of marked content (``/ActualText``, ``/Alt``, ``/E``) and the
  logical structure tree are removed - they often repeat names verbatim,
* page thumbnails are removed.
"""

from __future__ import annotations

import pikepdf
from pikepdf import Array, Dictionary, Name

NOTICE_FORMS_FLATTENED = "form_fields_flattened"
NOTICE_ANNOTATIONS = "annotations_removed"
NOTICE_METADATA = "metadata_cleared"
NOTICE_BOOKMARKS = "bookmarks_removed"
NOTICE_ATTACHMENTS = "attachments_removed"
NOTICE_SCRIPTS = "scripts_removed"
NOTICE_HIDDEN_TEXT = "hidden_descriptions_removed"

_MARKED_CONTENT_TEXT_KEYS = ("/ActualText", "/Alt", "/E")


def sanitize(pdf: pikepdf.Pdf) -> list[str]:
    """Sanitize ``pdf`` in place and return notice codes describing what was changed."""
    notices: list[str] = []
    root = pdf.Root

    if Name.AcroForm in root:
        try:
            if root.AcroForm.get(Name.NeedAppearances, False):
                pdf.generate_appearance_streams()
        except Exception:  # pragma: no cover - qpdf cannot always regenerate appearances
            pass
        pdf.flatten_annotations(mode="all")
        if Name.AcroForm in root:  # qpdf drops it itself when every field was flattened
            del root[Name.AcroForm]
        notices.append(NOTICE_FORMS_FLATTENED)

    removed_annotations = False
    for page in pdf.pages:
        if Name.Annots in page.obj:
            if len(page.obj.Annots):
                removed_annotations = True
            del page.obj[Name.Annots]
        for key in (Name.Thumb, Name.PieceInfo, Name.AA):
            if key in page.obj:
                del page.obj[key]
    if removed_annotations:
        notices.append(NOTICE_ANNOTATIONS)

    if _clear_metadata(pdf):
        notices.append(NOTICE_METADATA)
    if Name.Outlines in root:
        del root[Name.Outlines]
        notices.append(NOTICE_BOOKMARKS)
    if Name.Names in root:
        names = root.Names
        if Name.EmbeddedFiles in names:
            del names[Name.EmbeddedFiles]
            notices.append(NOTICE_ATTACHMENTS)
        if Name.JavaScript in names:
            del names[Name.JavaScript]
            notices.append(NOTICE_SCRIPTS)
    for key in (Name.OpenAction, Name.AA, Name.PieceInfo, Name.StructTreeRoot, Name.MarkInfo):
        if key in root:
            del root[key]

    if _strip_marked_content_texts(pdf):
        notices.append(NOTICE_HIDDEN_TEXT)
    return notices


def _clear_metadata(pdf: pikepdf.Pdf) -> bool:
    changed = False
    if Name.Metadata in pdf.Root:
        del pdf.Root[Name.Metadata]
        changed = True
    info = pdf.trailer.get(Name.Info)
    if info is not None and len(info):
        # Keep only technical, non-personal entries.
        for key in list(info.keys()):
            if key not in ("/CreationDate", "/ModDate", "/Trapped"):
                del info[key]
                changed = True
    return changed


def _strip_marked_content_texts(pdf: pikepdf.Pdf) -> bool:
    """Drop replacement texts from marked content (inline BDC dictionaries and /Properties)."""
    changed = False
    seen: set[tuple[int, int]] = set()
    for page in pdf.pages:
        changed |= _strip_in_content(pdf, page, page.obj.get(Name.Resources), seen)
    return changed


def _strip_in_content(
    pdf: pikepdf.Pdf,
    target: pikepdf.Page | pikepdf.Stream,
    resources: Dictionary | None,
    seen: set[tuple[int, int]],
) -> bool:
    changed = False
    instructions = pikepdf.parse_content_stream(target)
    rewritten = []
    content_changed = False
    for instruction in instructions:
        operator = str(instruction.operator)
        operands = list(instruction.operands)
        if operator == "BDC" and len(operands) == 2 and isinstance(operands[1], Dictionary):
            properties = operands[1]
            if any(key in properties for key in _MARKED_CONTENT_TEXT_KEYS):
                for key in _MARKED_CONTENT_TEXT_KEYS:
                    if key in properties:
                        del properties[key]
                content_changed = True
        rewritten.append(
            pikepdf.ContentStreamInstruction(operands, instruction.operator)
            if not isinstance(instruction, pikepdf.ContentStreamInlineImage)
            else instruction
        )

    if resources is not None:
        properties = resources.get(Name.Properties)
        if properties is not None:
            for _key, value in properties.items():
                if isinstance(value, Dictionary):
                    for key in _MARKED_CONTENT_TEXT_KEYS:
                        if key in value:
                            del value[key]
                            changed = True
        xobjects = resources.get(Name.XObject)
        if xobjects is not None:
            for _key, xobject in xobjects.items():
                if (
                    not isinstance(xobject, pikepdf.Stream)
                    or xobject.get(Name.Subtype) != Name.Form
                ):
                    continue
                key = xobject.objgen
                if key != (0, 0):
                    if key in seen:
                        continue
                    seen.add(key)
                changed |= _strip_in_content(pdf, xobject, xobject.get(Name.Resources), seen)

    if content_changed:
        data = pikepdf.unparse_content_stream(rewritten)
        if isinstance(target, pikepdf.Page):
            target.obj.Contents = pdf.make_stream(data)
        else:
            target.write(data)
        changed = True
    return changed


def remove_unused(pdf: pikepdf.Pdf) -> None:
    """Drop resources no page draws, so unused objects cannot carry original text."""
    pdf.remove_unreferenced_resources()


__all__ = ["Array", "sanitize", "remove_unused"]
