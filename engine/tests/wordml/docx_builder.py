"""Build small but structurally real DOCX packages from raw WordprocessingML."""

from __future__ import annotations

import io
import zipfile

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NAMESPACES = (
    f'xmlns:w="{W_NS}" xmlns:r="{R_NS}" '
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
    'xmlns:v="urn:schemas-microsoft-com:vml" '
    'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" '
    'mc:Ignorable="w15"'
)
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles {NAMESPACES}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normalny"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Nagwek1"><w:name w:val="heading 1"/>
<w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>"""
CORE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
 xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>Umowa Jan Kowalski</dc:title><dc:creator>Michał Testowy</dc:creator>
<cp:lastModifiedBy>Michał Testowy</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">2026-10-01T10:00:00Z</dcterms:created>
</cp:coreProperties>"""


def body_document(body: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f"<w:document {NAMESPACES}><w:body>{body}"
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'
    )


def build_docx(
    body: str,
    *,
    parts: dict[str, str] | None = None,
    document_rels: list[tuple[str, str, str, bool]] | None = None,
    package_rels: list[tuple[str, str, str]] | None = None,
    overrides: dict[str, str] | None = None,
    document_xml: str | None = None,
) -> bytes:
    """Return DOCX bytes.

    ``document_rels`` items are ``(id, type_suffix, target, external)``; ``package_rels``
    items are ``(id, full_type, target)``; ``overrides`` maps part name -> content type.
    """
    parts = dict(parts or {})
    content_overrides = {
        "word/document.xml": (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
        ),
        "word/styles.xml": (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"
        ),
        "docProps/core.xml": "application/vnd.openxmlformats-package.core-properties+xml",
        **(overrides or {}),
    }
    types = "".join(
        f'<Override PartName="/{name}" ContentType="{kind}"/>'
        for name, kind in content_overrides.items()
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" '
        'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="png" ContentType="image/png"/>'
        f"{types}</Types>"
    )
    root_rels = [
        ("rId1", f"{REL}/officeDocument", "word/document.xml"),
        (
            "rId2",
            "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
            "docProps/core.xml",
        ),
        *(package_rels or []),
    ]
    doc_rels = [("rIdStyles", "styles", "styles.xml", False), *(document_rels or [])]
    files = {
        "[Content_Types].xml": content_types,
        "_rels/.rels": _rels((rid, kind, target, False) for rid, kind, target in root_rels),
        "word/document.xml": document_xml or body_document(body),
        "word/_rels/document.xml.rels": _rels(
            (rid, f"{REL}/{kind}" if "://" not in kind else kind, target, external)
            for rid, kind, target, external in doc_rels
        ),
        "word/styles.xml": STYLES,
        "docProps/core.xml": CORE,
        **parts,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content.encode("utf-8") if isinstance(content, str) else content)
    return buffer.getvalue()


def _rels(items) -> str:
    entries = "".join(
        f'<Relationship Id="{rid}" Type="{kind}" Target="{target}"'
        + (' TargetMode="External"' if external else "")
        + "/>"
        for rid, kind, target, external in items
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f"{entries}</Relationships>"
    )


def p(*runs: str, style: str | None = None) -> str:
    props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{props}{''.join(runs)}</w:p>"


def r(text: str, props: str = "") -> str:
    rpr = f"<w:rPr>{props}</w:rPr>" if props else ""
    return f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r>'


def read_part(data: bytes, name: str) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return archive.read(name).decode("utf-8")


def part_names(data: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return archive.namelist()
