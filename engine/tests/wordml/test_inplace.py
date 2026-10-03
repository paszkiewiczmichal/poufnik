"""In-place DOCX anonymization: layout preserved, nothing original left behind."""

from __future__ import annotations

import io
import zipfile

import pytest
from docx_builder import STYLES, build_docx, p, part_names, r, read_part

from anonymizer_engine.anonymize import OffsetMapEntry
from anonymizer_engine.parsers import UnsupportedFormat, parse_document
from anonymizer_engine.wordml import DocxExportError, anonymize_docx_in_place

FOOTNOTES_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"


def _export(data: bytes, *values: tuple[str, str]) -> tuple[bytes, str]:
    """Anonymize every occurrence of each (value, token) pair in the parsed text."""
    text = parse_document(data, filename="test.docx").text
    spans: list[tuple[int, int, str]] = []
    for value, token in values:
        start = text.find(value)
        assert start >= 0, f"{value!r} not in parsed text {text!r}"
        while start >= 0:
            spans.append((start, start + len(value), token))
            start = text.find(value, start + len(value))
    spans.sort()
    offset_map: list[OffsetMapEntry] = []
    parts: list[str] = []
    cursor = 0
    position = 0
    for start, end, token in spans:
        parts.append(text[cursor:start])
        position += start - cursor
        offset_map.append(
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
    anonymized = "".join(parts)
    result = anonymize_docx_in_place(data, offset_map, anonymized)
    return result.content, anonymized


def _all_xml(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return "".join(
            archive.read(name).decode("utf-8", "replace")
            for name in archive.namelist()
            if name.endswith((".xml", ".rels"))
        )


def test_name_split_across_formatted_runs_becomes_one_token_with_first_run_formatting() -> None:
    data = build_docx(
        p(r("Umowę zawarto z "), r("Janem ", "<w:b/>"), r("Kowal", "<w:i/>"), r("skim.", "<w:i/>"))
    )

    out, anonymized = _export(data, ("Janem Kowalskim", "[OSOBA_1]"))

    assert anonymized == "Umowę zawarto z [OSOBA_1]."
    document = read_part(out, "word/document.xml")
    assert '<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">[OSOBA_1]</w:t>' in document
    assert "Kowal" not in document
    assert parse_document(out, filename="out.docx").text == anonymized


def test_untouched_parts_keep_their_original_bytes() -> None:
    data = build_docx(p(r("Jan Kowalski")))

    out, _ = _export(data, ("Jan Kowalski", "[OSOBA_1]"))

    assert read_part(out, "word/styles.xml") == STYLES
    assert read_part(out, "[Content_Types].xml") == read_part(data, "[Content_Types].xml")


def test_entity_over_a_line_break_removes_the_break_inside_the_span() -> None:
    data = build_docx(p(r("ul. Lipowa 8"), "<w:r><w:br/></w:r>", r("31-001 Kraków, dalej")))
    text = parse_document(data, filename="t.docx").text
    assert text == "ul. Lipowa 8\n31-001 Kraków, dalej"

    out, anonymized = _export(data, ("ul. Lipowa 8\n31-001 Kraków", "[ADRES_1]"))

    assert parse_document(out, filename="out.docx").text == anonymized == "[ADRES_1], dalej"


def test_tracked_changes_are_accepted_before_parsing_and_export() -> None:
    body = (
        p(
            r("Strony: "),
            '<w:ins w:id="1" w:author="Michał Testowy">'
            "<w:r><w:t>Tomasz Lewandowski</w:t></w:r></w:ins>",
            '<w:del w:id="2" w:author="Michał Testowy">'
            "<w:r><w:delText>Barbara Kamińska</w:delText></w:r></w:del>",
        )
        + '<w:p><w:pPr><w:rPr><w:del w:id="3" w:author="X"/></w:rPr></w:pPr>'
        + r("Połączony ")
        + "</w:p>"
        + p(r("akapit."))
    )
    data = build_docx(body)

    parsed = parse_document(data, filename="t.docx")
    assert parsed.text == "Strony: Tomasz Lewandowski\n\nPołączony akapit."
    assert "tracked_changes_accepted" in parsed.notices

    out, _ = _export(data, ("Tomasz Lewandowski", "[OSOBA_1]"))
    xml = _all_xml(out)
    assert "Kamińska" not in xml
    assert "w:del " not in xml and "w:ins " not in xml
    assert "Michał Testowy" not in xml


def test_comments_are_removed_with_their_parts_and_relationships() -> None:
    comments = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:comment w:id="0" w:author="Michał Testowy"><w:p><w:r>'
        "<w:t>Zadzwonić do Marka Zielińskiego</w:t></w:r></w:p></w:comment></w:comments>"
    )
    body = p(
        '<w:commentRangeStart w:id="0"/>',
        r("Jan Kowalski"),
        '<w:commentRangeEnd w:id="0"/>',
        '<w:r><w:commentReference w:id="0"/></w:r>',
    )
    data = build_docx(
        body,
        parts={"word/comments.xml": comments},
        document_rels=[("rIdC", "comments", "comments.xml", False)],
        overrides={
            "word/comments.xml": (
                "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"
            )
        },
    )

    out, _ = _export(data, ("Jan Kowalski", "[OSOBA_1]"))

    assert "word/comments.xml" not in part_names(out)
    xml = _all_xml(out)
    assert "Zieli" not in xml and "comments.xml" not in xml
    assert "commentReference" not in xml and "commentRange" not in xml


def test_footnotes_are_parsed_and_anonymized() -> None:
    footnotes = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p>'
        '</w:footnote><w:footnote w:id="1"><w:p><w:r>'
        "<w:t>Pełnomocnictwo dla Piotra Wiśniewskiego.</w:t></w:r></w:p></w:footnote></w:footnotes>"
    )
    data = build_docx(
        p(r("Tekst"), '<w:r><w:footnoteReference w:id="1"/></w:r>'),
        parts={"word/footnotes.xml": footnotes},
        document_rels=[("rIdF", "footnotes", "footnotes.xml", False)],
        overrides={"word/footnotes.xml": FOOTNOTES_TYPE},
    )

    assert parse_document(data, filename="t.docx").text == (
        "Tekst\n\nPełnomocnictwo dla Piotra Wiśniewskiego."
    )
    out, _ = _export(data, ("Piotra Wiśniewskiego", "[OSOBA_1]"))

    assert "Wiśniewskiego" not in read_part(out, "word/footnotes.xml")
    assert "[OSOBA_1]" in read_part(out, "word/footnotes.xml")


def test_text_box_is_anonymized_and_its_legacy_vml_copy_dropped() -> None:
    box = (
        "<w:r><mc:AlternateContent>"
        '<mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData>'
        "<wps:wsp><wps:txbx><w:txbxContent>"
        + p(r("Krzysztof Wójcik"))
        + "</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor>"
        "</w:drawing></mc:Choice>"
        "<mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>"
        + p(r("Krzysztof Wójcik"))
        + "</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>"
        "</mc:AlternateContent></w:r>"
    )
    data = build_docx(p(r("Pole: "), box))

    assert parse_document(data, filename="t.docx").text == "Pole:\n\nKrzysztof Wójcik"
    out, _ = _export(data, ("Krzysztof Wójcik", "[OSOBA_1]"))

    document = read_part(out, "word/document.xml")
    assert "Wójcik" not in document
    assert "mc:Fallback" not in document
    assert "[OSOBA_1]" in document


def test_hyperlink_target_and_screen_tip_do_not_keep_the_address() -> None:
    body = p(
        r("Kontakt: "),
        '<w:hyperlink r:id="rIdL" w:tooltip="Napisz do Jana Kowalskiego">'
        + r("jan.kowalski@example.test")
        + "</w:hyperlink>",
    )
    data = build_docx(
        body,
        document_rels=[("rIdL", "hyperlink", "mailto:jan.kowalski@example.test", True)],
    )

    out, _ = _export(data, ("jan.kowalski@example.test", "[EMAIL_1]"))

    xml = _all_xml(out)
    assert "jan.kowalski" not in xml
    assert "Kowalskiego" not in xml
    assert "mailto:%5BEMAIL_1%5D" in read_part(out, "word/_rels/document.xml.rels")


def test_field_instruction_split_over_runs_is_anonymized() -> None:
    body = p(
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
        '<w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:jan.kow</w:instrText></w:r>',
        '<w:r><w:instrText xml:space="preserve">alski@example.test" </w:instrText></w:r>',
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
        r("jan.kowalski@example.test"),
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    )
    data = build_docx(body)

    out, _ = _export(data, ("jan.kowalski@example.test", "[EMAIL_1]"))

    document = read_part(out, "word/document.xml")
    assert "kowalski" not in document
    assert 'HYPERLINK "mailto:[EMAIL_1]"' in document


def test_personal_metadata_custom_xml_and_data_bindings_are_removed() -> None:
    body = p(
        r("Pełnomocnik: "),
        '<w:sdt><w:sdtPr><w:dataBinding w:xpath="/klient/nazwisko" w:storeItemID="{1}"/>'
        "</w:sdtPr><w:sdtContent>" + r("Jan Kowalski") + "</w:sdtContent></w:sdt>",
    )
    data = build_docx(
        body,
        parts={"customXml/item1.xml": "<klient><nazwisko>Jan Kowalski</nazwisko></klient>"},
        document_rels=[("rIdX", "customXml", "../customXml/item1.xml", False)],
    )

    parsed = parse_document(data, filename="t.docx")
    assert parsed.text == "Pełnomocnik: Jan Kowalski"
    out, _ = _export(data, ("Jan Kowalski", "[OSOBA_1]"))

    assert "customXml/item1.xml" not in part_names(out)
    xml = _all_xml(out)
    assert "Kowalski" not in xml
    assert "dataBinding" not in xml
    core = read_part(out, "docProps/core.xml")
    assert "Michał Testowy" not in core
    assert "2026-10-01T10:00:00Z" in core  # dates are not personal data and stay


def test_value_in_an_unwalked_part_is_replaced_by_the_safety_net() -> None:
    glossary = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:glossaryDocument xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:docParts><w:docPart><w:docPartBody>"
        + p(r("Szablon: Jan "), r("Kowalski"))
        + "</w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>"
    )
    data = build_docx(
        p(r("Jan Kowalski")),
        parts={"word/glossary/document.xml": glossary},
        document_rels=[("rIdG", "glossaryDocument", "glossary/document.xml", False)],
    )

    out, _ = _export(data, ("Jan Kowalski", "[OSOBA_1]"))

    glossary_out = read_part(out, "word/glossary/document.xml")
    assert "Kowalski" not in glossary_out
    assert "[OSOBA_1]" in glossary_out


def test_value_that_cannot_be_rewritten_safely_stops_the_export() -> None:
    chart = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">'
        "<c:numCache><c:pt><c:v>44051401359</c:v></c:pt></c:numCache></c:chartSpace>"
    )
    data = build_docx(
        p(r("PESEL 44051401359")),
        parts={"word/charts/chart1.xml": chart},
        document_rels=[("rIdH", "chart", "charts/chart1.xml", False)],
    )

    with pytest.raises(DocxExportError, match="word/charts/chart1.xml"):
        _export(data, ("44051401359", "[PESEL_1]"))


def test_values_the_user_left_visible_stay_and_are_not_reported() -> None:
    data = build_docx(p(r("Jan Kowalski i Jan Kowalski")))
    text = parse_document(data, filename="t.docx").text
    # Only the first occurrence is anonymized (the user rejected the second one).
    entry = OffsetMapEntry(
        original_start=0,
        original_end=12,
        anonymized_start=0,
        anonymized_end=9,
        token="[OSOBA_1]",
        category="PERSON",
    )
    anonymized = "[OSOBA_1]" + text[12:]

    result = anonymize_docx_in_place(data, [entry], anonymized)

    assert parse_document(result.content, filename="o.docx").text == "[OSOBA_1] i Jan Kowalski"


def test_export_refuses_a_file_that_does_not_match_the_result() -> None:
    data = build_docx(p(r("Jan Kowalski")))
    entry = OffsetMapEntry(
        original_start=0,
        original_end=12,
        anonymized_start=0,
        anonymized_end=9,
        token="[OSOBA_1]",
        category="PERSON",
    )

    with pytest.raises(DocxExportError, match="does not match"):
        anonymize_docx_in_place(data, [entry], "[OSOBA_1] zmieniony")


def test_heading_kind_comes_from_the_style_name_not_its_localized_id() -> None:
    data = build_docx(p(r("Umowa"), style="Nagwek1") + p(r("Treść")))

    parsed = parse_document(data, filename="t.docx")

    assert [block.kind for block in parsed.blocks] == ["heading", "paragraph"]


def test_merged_table_cells_are_not_duplicated() -> None:
    table = (
        "<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>"
        '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>'
        + p(r("Jan Kowalski"))
        + "</w:tc></w:tr><w:tr><w:tc>"
        + p(r("a"))
        + "</w:tc><w:tc>"
        + p(r("b"))
        + "</w:tc></w:tr></w:tbl>"
    )
    data = build_docx(table)

    assert parse_document(data, filename="t.docx").text == "Jan Kowalski\na\tb"


def test_embedded_foreign_document_is_removed_and_media_is_flagged() -> None:
    data = build_docx(
        p(r("Jan Kowalski")) + '<w:altChunk r:id="rIdA"/>',
        parts={
            "word/afchunk.mht": "<html><body>Jan Kowalski, PESEL 44051401359</body></html>",
            "word/media/image1.png": "not really a png",
        },
        document_rels=[("rIdA", "aFChunk", "afchunk.mht", False)],
    )

    parsed = parse_document(data, filename="t.docx")
    assert "embedded_document_removed" in parsed.notices
    assert "images_or_objects_present" in parsed.notices
    out, _ = _export(data, ("Jan Kowalski", "[OSOBA_1]"))

    assert "word/afchunk.mht" not in part_names(out)
    assert "altChunk" not in read_part(out, "word/document.xml")


def test_strict_open_xml_is_refused_instead_of_read_as_empty() -> None:
    strict = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main">'
        "<w:body><w:p><w:r><w:t>Jan Kowalski</w:t></w:r></w:p></w:body></w:document>"
    )
    data = build_docx("", document_xml=strict)

    with pytest.raises(UnsupportedFormat, match="Strict Open XML"):
        parse_document(data, filename="t.docx")
