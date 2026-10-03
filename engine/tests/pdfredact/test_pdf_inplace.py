"""In-place PDF anonymization: every other glyph stays where it was, no value survives."""

from __future__ import annotations

import io
import os
import re
import shutil
import subprocess
from collections import Counter
from pathlib import Path

import pikepdf
import pytest
from pdf_builder import glyph_positions, raw_pdf, spans_for, text_of
from pikepdf import Dictionary, Name

from anonymizer_engine.pdfredact import PdfExportError, anonymize_pdf_in_place

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def _export(data: bytes, *values: tuple[str, str]) -> tuple[bytes, str]:
    entries, anonymized = spans_for(text_of(data), *values)
    return anonymize_pdf_in_place(data, entries, anonymized), anonymized


def _assert_only_values_removed(original: bytes, exported: bytes, *values: str) -> None:
    """Glyphs drawn by the export (Helvetica labels) aside, the result has exactly the
    original glyphs at exactly the original positions, minus the glyphs of the values."""
    before, after = glyph_positions(original), glyph_positions(exported)
    assert not after - before, "a glyph moved or appeared"
    removed = Counter(
        text for (_page, text, _x, _top), count in (before - after).items() for _ in range(count)
    )
    expected = Counter(char for value in values for char in value if char.strip())
    assert removed == expected


def test_text_pdf_keeps_every_other_glyph_in_place_with_kerning_and_spacing() -> None:
    content = (
        b"BT /F1 12 Tf 1.5 Tc 4 Tw 72 700 Td "
        b"[(Umow) -20 (e zawarto z Janem ) 15 (Kowalskim, PESEL 44051401359, w Gda) 5 (nsku.)] TJ "
        b"ET"
    )
    data = raw_pdf(content)

    out, anonymized = _export(data, ("Janem Kowalskim", "[OSOBA_1]"), ("44051401359", "[PESEL_1]"))

    assert "Kowalski" not in text_of(out) and "44051401359" not in text_of(out)
    assert "[OSOBA_1]" in text_of(out) and "[PESEL_1]" in text_of(out)
    _assert_only_values_removed(data, out, "Janem Kowalskim", "44051401359")
    assert anonymized.startswith("Umowe zawarto z [OSOBA_1], PESEL [PESEL_1]")


def test_quote_operators_are_rewritten_without_moving_text() -> None:
    content = (
        b"BT /F1 11 Tf 14 TL 72 700 Td (Strona pierwsza) Tj "
        b"(Pelnomocnik Jan Kowalski dziala) ' "
        b'2 0.5 (Adres: Lipowa 8, Krakow) " ET'
    )
    data = raw_pdf(content)

    out, _ = _export(data, ("Jan Kowalski", "[OSOBA_1]"), ("Lipowa 8, Krakow", "[ADRES_1]"))

    _assert_only_values_removed(data, out, "Jan Kowalski", "Lipowa 8, Krakow")


def test_text_inside_a_form_xobject_is_removed_too() -> None:
    def letterhead(pdf: pikepdf.Pdf) -> dict:
        font = Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name("/Times-Roman"))
        stream = pdf.make_stream(
            b"BT /F1 10 Tf 0 0 Td (Kancelaria Piotr Zielinski) Tj ET",
            Type=Name.XObject,
            Subtype=Name.Form,
            BBox=[0, 0, 300, 20],
            Resources=Dictionary(Font=Dictionary(F1=font)),
        )
        return {"/XObject": Dictionary(Head=stream)}

    content = b"q 1 0 0 1 72 780 cm /Head Do Q BT /F1 12 Tf 72 700 Td (Tresc pisma.) Tj ET"
    data = raw_pdf(content, extra_resources=letterhead)

    out, _ = _export(data, ("Piotr Zielinski", "[OSOBA_1]"))

    assert "Zielinski" not in text_of(out)
    _assert_only_values_removed(data, out, "Piotr Zielinski")


def test_shifted_mediabox_places_the_token_on_the_value() -> None:
    content = b"BT /F1 12 Tf 150 700 Td (Powod: Anna Nowak, Gdansk) Tj ET"
    data = raw_pdf(content, mediabox=(50, 20, 645, 862))

    out, _ = _export(data, ("Anna Nowak", "[OSOBA_1]"))

    _assert_only_values_removed(data, out, "Anna Nowak")
    assert text_of(out) == "Powod: [OSOBA_1], Gdansk"


def test_word_pdf_with_cid_fonts_and_tagged_structure() -> None:
    data = (FIXTURES / "pismo-word.pdf").read_bytes()
    text = text_of(data)
    assert "Anna Nowak" in text and "90010112345" in text

    out, _ = _export(data, ("Anna Nowak", "[OSOBA_1]"), ("90010112345", "[PESEL_1]"))

    result = text_of(out)
    assert "Anna Nowak" not in result and "90010112345" not in result
    assert result.count("[OSOBA_1]") == text.count("Anna Nowak")
    _assert_only_values_removed(
        data, out, *(["Anna Nowak"] * text.count("Anna Nowak")), "90010112345"
    )
    exported = pikepdf.open(io.BytesIO(out))
    assert exported.docinfo.get("/Author") is None
    assert Name.StructTreeRoot not in exported.Root and Name.Metadata not in exported.Root


def test_links_annotations_and_metadata_do_not_keep_values() -> None:
    content = b"BT /F1 12 Tf 72 700 Td (Kontakt: jan.kowalski@example.test) Tj ET"
    data = raw_pdf(content, info={"/Author": "Jan Kowalski", "/Title": "Umowa Kowalski"})
    pdf = pikepdf.open(io.BytesIO(data))
    pdf.pages[0].obj.Annots = pdf.make_indirect(
        [
            Dictionary(
                Type=Name.Annot,
                Subtype=Name.Link,
                Rect=[110, 695, 300, 715],
                A=Dictionary(S=Name.URI, URI=pikepdf.String("mailto:jan.kowalski@example.test")),
            )
        ]
    )
    buffer = io.BytesIO()
    pdf.save(buffer)
    data = buffer.getvalue()

    out, _ = _export(data, ("jan.kowalski@example.test", "[EMAIL_1]"))

    assert b"kowalski" not in out.lower()
    exported = pikepdf.open(io.BytesIO(out))
    assert Name.Annots not in exported.pages[0].obj
    assert exported.docinfo.get("/Author") is None


def test_filled_form_field_is_flattened_and_anonymized() -> None:
    from reportlab.pdfgen import canvas

    buffer = io.BytesIO()
    page = canvas.Canvas(buffer)
    page.setFont("Times-Roman", 12)
    page.drawString(72, 750, "Wniosek")
    page.acroForm.textfield(
        name="imie", value="Jan Kowalski", x=72, y=700, width=200, height=20, fontName="Times-Roman"
    )
    page.save()
    data = buffer.getvalue()
    assert "Jan Kowalski" in text_of(data)

    out, _ = _export(data, ("Jan Kowalski", "[OSOBA_1]"))

    assert "Kowalski" not in text_of(out)
    assert b"Kowalski" not in out
    assert Name.AcroForm not in pikepdf.open(io.BytesIO(out)).Root


def test_embedded_truetype_font_with_polish_letters() -> None:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    from anonymizer_engine.anonymize.export import _register_dejavu_font

    font = _register_dejavu_font()
    assert font in pdfmetrics.getRegisteredFontNames()
    assert isinstance(pdfmetrics.getFont(font), TTFont)
    buffer = io.BytesIO()
    page = canvas.Canvas(buffer)
    page.setFont(font, 11)
    page.drawString(72, 700, "Zażółć: Małgorzata Wiśniewska, ul. Łąkowa 5, Łódź.")
    page.save()
    data = buffer.getvalue()

    out, _ = _export(
        data, ("Małgorzata Wiśniewska", "[OSOBA_1]"), ("ul. Łąkowa 5, Łódź", "[ADRES_1]")
    )

    # A token narrower than the removed value leaves a gap that text extraction reads as a
    # space before the punctuation; on the page everything else stays where it was.
    assert re.sub(r" ([,.])", r"\1", text_of(out)) == "Zażółć: [OSOBA_1], [ADRES_1]."
    before = glyph_positions(data, exclude_font="Helvetica")
    after = glyph_positions(out, exclude_font="Helvetica")
    assert not after - before


def test_export_refuses_a_file_that_does_not_match_the_result() -> None:
    data = raw_pdf(b"BT /F1 12 Tf 72 700 Td (Jan Kowalski) Tj ET")
    entries, _ = spans_for(text_of(data), ("Jan Kowalski", "[OSOBA_1]"))

    with pytest.raises(PdfExportError, match="does not match"):
        anonymize_pdf_in_place(data, entries, "[OSOBA_1] zmieniony")


# ------------------------------------------------------------------ scans
def _tesseract() -> str | None:
    return os.environ.get("ANONYMIZER_TESSERACT_PATH") or shutil.which("tesseract")


_REQUIRES_TESSERACT = pytest.mark.skipif(
    _tesseract() is None, reason="Tesseract is required for scanned-PDF tests."
)


def _scan_image() -> object:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument((FIXTURES / "pismo-word.pdf").read_bytes())
    image = document[0].render(scale=200 / 72).to_pil().convert("L")
    document.close()
    return image


@pytest.mark.ocr
@_REQUIRES_TESSERACT
def test_image_only_scan_is_rebuilt_without_the_values() -> None:
    from anonymizer_engine.parsers import parse_document
    from anonymizer_engine.pdfredact.scan import anonymize_scanned_pdf

    buffer = io.BytesIO()
    _scan_image().save(buffer, format="PDF", resolution=200)
    data = buffer.getvalue()
    parsed = parse_document(data, filename="skan.pdf")
    assert parsed.source == "ocr"
    entries, anonymized = spans_for(parsed.text, ("90010112345", "[PESEL_1]"))

    out = anonymize_scanned_pdf(data, entries, anonymized)

    # Rebuilt page: one new raster, the original scan image is gone from the file.
    exported = pikepdf.open(io.BytesIO(out))
    images = [
        obj
        for obj in exported.objects
        if isinstance(obj, pikepdf.Stream) and obj.get(Name.Subtype) == Name.Image
    ]
    assert len(images) == 1
    import pdfplumber

    with pdfplumber.open(io.BytesIO(out)) as exported:
        assert "[PESEL_1]" in (exported.pages[0].extract_text() or "")  # the drawn label
    from anonymizer_engine.ocr import ocr_pdf

    assert "90010112345" not in ocr_pdf(out).text


@pytest.mark.ocr
@_REQUIRES_TESSERACT
def test_scan_with_ocr_text_layer_has_values_removed_from_text_and_pixels(tmp_path: Path) -> None:
    image_path = tmp_path / "skan.png"
    _scan_image().save(image_path, dpi=(200, 200))
    subprocess.run(
        [_tesseract(), str(image_path), str(tmp_path / "skan"), "-l", "pol", "pdf"],
        check=True,
        capture_output=True,
    )
    data = (tmp_path / "skan.pdf").read_bytes()
    assert "90010112345" in text_of(data)

    out, _ = _export(data, ("90010112345", "[PESEL_1]"))

    from anonymizer_engine.ocr import ocr_pdf

    assert "90010112345" not in text_of(out)
    assert "90010112345" not in ocr_pdf(out).text


def test_space_glyphs_inside_a_value_are_removed_with_it() -> None:
    value = "Kancelaria Radcy Prawnego Piotr Zielinski"
    data = raw_pdf(
        b"BT /F1 12 Tf 72 700 Td "
        b"(Strona: Kancelaria Radcy Prawnego Piotr Zielinski, ul. Dluga 15 w Gdansku.) Tj ET"
    )

    out, _ = _export(data, (value, "[FIRMA_1]"))

    before = glyph_positions(data, blanks=True)
    after = glyph_positions(out, blanks=True)
    removed = Counter(text for (_p, text, _x, _t), n in (before - after).items() for _ in range(n))
    assert removed == Counter(value)  # letters and the four spaces between the words
    assert not after - before


def test_raw_scan_finds_a_value_written_as_plain_bytes() -> None:
    from anonymizer_engine.pdfredact.redact import Replacement, SensitiveValues, _raw_stream_hits

    pdf = pikepdf.open(io.BytesIO(raw_pdf(b"BT /F1 12 Tf 72 700 Td (Jan Kowalski) Tj ET")))

    found = SensitiveValues("Jan Kowalski", [Replacement(0, 12, "[OSOBA_1]")])
    absent = SensitiveValues("Anna Nowak", [Replacement(0, 10, "[OSOBA_1]")])

    assert _raw_stream_hits(pdf, found)
    assert not _raw_stream_hits(pdf, absent)


@pytest.mark.ocr
@_REQUIRES_TESSERACT
def test_raster_check_stops_an_export_whose_pixels_still_show_a_value() -> None:
    from anonymizer_engine.pdfredact.redact import Replacement, SensitiveValues
    from anonymizer_engine.pdfredact.scan import verify_rasters

    buffer = io.BytesIO()
    _scan_image().save(buffer, format="PDF", resolution=200)
    values = SensitiveValues("PESEL 90010112345", [Replacement(6, 17, "[PESEL_1]")])

    with pytest.raises(PdfExportError, match="still readable on page 1"):
        verify_rasters(buffer.getvalue(), [0], "PESEL [PESEL_1]", values)


@pytest.mark.ocr
@_REQUIRES_TESSERACT
def test_visible_text_over_a_page_sized_image_also_rebuilds_the_image() -> None:
    import zlib

    def background(pdf: pikepdf.Pdf) -> dict:
        image = pdf.make_stream(
            zlib.compress(bytes([235]) * 100 * 100),
            Type=Name.XObject,
            Subtype=Name.Image,
            Width=100,
            Height=100,
            ColorSpace=Name.DeviceGray,
            BitsPerComponent=8,
            Filter=Name.FlateDecode,
        )
        return {"/XObject": Dictionary(Bg=image)}

    content = (
        b"q 595 0 0 842 0 0 cm /Bg Do Q "
        b"BT /F1 14 Tf 72 700 Td (Wnioskodawca: Jan Kowalski, PESEL 44051401359.) Tj ET"
    )
    data = raw_pdf(content, extra_resources=background)

    out, _ = _export(data, ("Jan Kowalski", "[OSOBA_1]"), ("44051401359", "[PESEL_1]"))

    exported = pikepdf.open(io.BytesIO(out))
    widths = [
        int(obj.Width)
        for obj in exported.objects
        if isinstance(obj, pikepdf.Stream) and obj.get(Name.Subtype) == Name.Image
    ]
    assert widths and 100 not in widths  # the original background image is gone
    assert "Kowalski" not in text_of(out)


def test_space_glyphs_of_a_value_broken_over_two_lines_are_removed() -> None:
    data = raw_pdf(
        b"BT /F1 12 Tf 14 TL 72 700 Td (Wnioskodawca: pani Joanna Maria) Tj "
        b"( Kowalska-Nowak, zamieszkala w Gdyni przy ulicy Morskiej.) ' ET"
    )
    text = text_of(data)
    value = text[text.index("Joanna") : text.index("-Nowak") + len("-Nowak")]
    assert "\n" in value  # the value really is broken over two lines

    out, _ = _export(data, (value, "[OSOBA_1]"))

    removed = glyph_positions(data, blanks=True) - glyph_positions(out, blanks=True)
    blanks_removed = sum(n for (_p, text, _x, _t), n in removed.items() if not text.strip())
    assert blanks_removed == 2  # "Joanna Maria" and the space opening the second line
    assert not glyph_positions(out, blanks=True) - glyph_positions(data, blanks=True)


@pytest.mark.parametrize("rotate", [90, 180, 270])
def test_rotated_page_is_read_upright_and_shown_upright(rotate: int) -> None:
    content = b"BT /F1 12 Tf 150 700 Td (Powod: Anna Nowak, zamieszkala w Gdansku.) Tj ET"
    data = raw_pdf(content, rotate=rotate)
    # The text runs horizontally in the file; /Rotate made viewers show it sideways.
    assert text_of(data) == "Powod: Anna Nowak, zamieszkala w Gdansku."

    out, _ = _export(data, ("Anna Nowak", "[OSOBA_1]"))

    assert text_of(out) == "Powod: [OSOBA_1], zamieszkala w Gdansku."
    exported = pikepdf.open(io.BytesIO(out))
    assert int(exported.pages[0].obj.get(Name.Rotate, 0)) == 0
    _assert_only_values_removed(data, out, "Anna Nowak")


def test_page_rotated_on_purpose_keeps_its_rotation() -> None:
    # Text drawn a quarter turn left in the content and /Rotate 90 turning it back:
    # upright as declared, so the declared rotation stays.
    content = (
        b"q 0 1 -1 0 595 0 cm BT /F1 12 Tf 150 300 Td "
        b"(Powod: Anna Nowak, zamieszkala w Gdansku.) Tj ET Q"
    )
    data = raw_pdf(content, rotate=90)

    out, _ = _export(data, ("Anna Nowak", "[OSOBA_1]"))

    assert text_of(out) == "Powod: [OSOBA_1], zamieszkala w Gdansku."
    exported = pikepdf.open(io.BytesIO(out))
    assert int(exported.pages[0].obj.Rotate) == 90


@pytest.mark.ocr
@_REQUIRES_TESSERACT
@pytest.mark.parametrize("turn", [90, 180])
def test_sideways_or_upside_down_scan_is_recognized_and_shown_upright(turn: int) -> None:
    from anonymizer_engine.ocr import ocr_pdf
    from anonymizer_engine.parsers import parse_document
    from anonymizer_engine.pdfredact.scan import anonymize_scanned_pdf

    buffer = io.BytesIO()
    _scan_image().rotate(turn, expand=True).save(buffer, format="PDF", resolution=200)
    data = buffer.getvalue()
    parsed = parse_document(data, filename="skan.pdf")
    assert "90010112345" in parsed.text  # readable only once the page is turned upright
    entries, anonymized = spans_for(parsed.text, ("90010112345", "[PESEL_1]"))

    out = anonymize_scanned_pdf(data, entries, anonymized)

    exported = pikepdf.open(io.BytesIO(out))
    assert int(exported.pages[0].obj.Rotate) == turn  # shown upright in viewers
    recognized = ocr_pdf(out).text
    assert "90010112345" not in recognized and "Pozwany" in recognized
