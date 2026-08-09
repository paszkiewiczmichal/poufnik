from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import pdfplumber
import pytest

from anonymizer_engine.anonymize import (
    TOKEN_PREFIXES,
    ReplacementMap,
    anonymize,
    deanonymize,
    export_docx,
    export_pdf,
    export_txt,
)
from anonymizer_engine.detection import EntityCategory, ValidationStatus, detect_all
from anonymizer_engine.detection.models import DetectedEntity
from anonymizer_engine.parsers import Block, ParsedDocument, parse_document


@dataclass(frozen=True)
class Token:
    text: str
    idx: int
    lemma_: str


class CorpusNerEngine:
    def __init__(self, entities: list[DetectedEntity]) -> None:
        self.entities = entities
        self.last_tokens: list[Token] = []

    def analyze(self, text: str, language: str) -> list[DetectedEntity]:
        assert language == "pl"
        assert text
        return [entity for entity in self.entities if entity.category not in _DETERMINISTIC]


_DETERMINISTIC = {
    EntityCategory.PESEL,
    EntityCategory.NIP,
    EntityCategory.REGON,
    EntityCategory.ID_CARD,
    EntityCategory.PASSPORT,
    EntityCategory.KRS,
    EntityCategory.BANK_ACCOUNT,
    EntityCategory.PAYMENT_CARD,
    EntityCategory.LAND_REGISTER,
    EntityCategory.PHONE,
    EntityCategory.EMAIL,
    EntityCategory.URL,
    EntityCategory.IP_ADDRESS,
    EntityCategory.MAC_ADDRESS,
    EntityCategory.API_KEY,
    EntityCategory.VEHICLE,
    EntityCategory.CASE_NUMBER,
    EntityCategory.ADMIN_CASE,
    EntityCategory.GPS,
    EntityCategory.MONEY,
}


@pytest.mark.parametrize(
    ("category", "prefix"),
    [
        (EntityCategory.PERSON, "OSOBA"),
        (EntityCategory.COMPANY, "FIRMA"),
        (EntityCategory.PUBLIC_INSTITUTION, "INSTYTUCJA"),
        (EntityCategory.ADDRESS, "ADRES"),
        (EntityCategory.PESEL, "PESEL"),
        (EntityCategory.NIP, "NIP"),
        (EntityCategory.REGON, "REGON"),
        (EntityCategory.ID_CARD, "DOWOD"),
        (EntityCategory.PASSPORT, "PASZPORT"),
        (EntityCategory.KRS, "KRS"),
        (EntityCategory.BANK_ACCOUNT, "RACHUNEK"),
        (EntityCategory.PAYMENT_CARD, "KARTA"),
        (EntityCategory.LAND_REGISTER, "KSIEGA_WIECZYSTA"),
        (EntityCategory.PHONE, "TELEFON"),
        (EntityCategory.EMAIL, "EMAIL"),
        (EntityCategory.URL, "URL"),
        (EntityCategory.IP_ADDRESS, "IP"),
        (EntityCategory.MAC_ADDRESS, "MAC"),
        (EntityCategory.API_KEY, "KLUCZ"),
        (EntityCategory.VEHICLE, "POJAZD"),
        (EntityCategory.CASE_NUMBER, "SYGNATURA"),
        (EntityCategory.ADMIN_CASE, "ZNAK_SPRAWY"),
        (EntityCategory.GPS, "GPS"),
        (EntityCategory.MONEY, "KWOTA"),
        (EntityCategory.DATE, "DATA"),
        ("CUSTOM", "DANE"),
    ],
)
def test_category_prefix_mapping(category: EntityCategory | str, prefix: str) -> None:
    assert TOKEN_PREFIXES[str(category)] == prefix


def test_anonymize_replaces_entities_from_end_and_builds_map() -> None:
    text = "Jan Kowalski ma PESEL 44051401359."
    result = anonymize(
        text,
        [
            _entity(text, "Jan Kowalski", EntityCategory.PERSON),
            _entity(text, "44051401359", EntityCategory.PESEL),
        ],
    )

    assert result.anonymized_text == "[OSOBA_1] ma PESEL [PESEL_1]."
    assert result.replacement_map.document_fingerprint
    assert [(entry.token, entry.canonical_text) for entry in result.replacement_map.entries] == [
        ("[OSOBA_1]", "Jan Kowalski"),
        ("[PESEL_1]", "44051401359"),
    ]


def test_anonymize_returns_offset_map_for_different_replacement_lengths() -> None:
    text = "Jan Kowalski ma PESEL 44051401359."

    result = anonymize(
        text,
        [
            _entity(text, "Jan Kowalski", EntityCategory.PERSON),
            _entity(text, "44051401359", EntityCategory.PESEL),
        ],
    )

    assert [entry.model_dump() for entry in result.offset_map] == [
        {
            "original_start": 0,
            "original_end": 12,
            "anonymized_start": 0,
            "anonymized_end": 9,
            "token": "[OSOBA_1]",
            "category": "PERSON",
        },
        {
            "original_start": 22,
            "original_end": 33,
            "anonymized_start": 19,
            "anonymized_end": 28,
            "token": "[PESEL_1]",
            "category": "PESEL",
        },
    ]
    for entry in result.offset_map:
        assert result.anonymized_text[entry.anonymized_start : entry.anonymized_end] == entry.token


def test_anonymize_offset_map_handles_adjacent_entities() -> None:
    text = "Anna44051401359"

    result = anonymize(
        text,
        [
            _entity(text, "Anna", EntityCategory.PERSON),
            _entity(text, "44051401359", EntityCategory.PESEL),
        ],
    )

    assert result.anonymized_text == "[OSOBA_1][PESEL_1]"
    assert [(entry.anonymized_start, entry.anonymized_end) for entry in result.offset_map] == [
        (0, len("[OSOBA_1]")),
        (len("[OSOBA_1]"), len("[OSOBA_1][PESEL_1]")),
    ]


def test_numbering_uses_first_occurrence_not_input_order() -> None:
    text = "Anna Nowak spotkała Jana Kowalskiego."
    entities = [
        _entity(text, "Jana Kowalskiego", EntityCategory.PERSON, canonical="Jan Kowalski"),
        _entity(text, "Anna Nowak", EntityCategory.PERSON),
    ]

    result = anonymize(text, entities)

    assert result.anonymized_text == "[OSOBA_1] spotkała [OSOBA_2]."
    assert [entry.canonical_text for entry in result.replacement_map.entries] == [
        "Anna Nowak",
        "Jan Kowalski",
    ]


def test_numbering_is_per_entity_group_not_per_mention() -> None:
    text = "Jan Kowalski podpisał. Rozmawiano z Janem Kowalskim."
    entities = [
        _entity(text, "Jan Kowalski", EntityCategory.PERSON, group="person-001"),
        _entity(
            text,
            "Janem Kowalskim",
            EntityCategory.PERSON,
            canonical="Jan Kowalski",
            group="person-001",
        ),
    ]

    result = anonymize(text, entities)

    assert result.anonymized_text == "[OSOBA_1] podpisał. Rozmawiano z [OSOBA_1]."
    assert len(result.replacement_map.entries) == 1
    assert result.replacement_map.entries[0].variants == ["Jan Kowalski", "Janem Kowalskim"]


def test_ungrouped_repeated_same_value_uses_one_token() -> None:
    text = "NIP 526-10-40-828 oraz ponownie 526-10-40-828."
    first = _entity(text, "526-10-40-828", EntityCategory.NIP)
    second_start = text.rindex("526-10-40-828")
    second = DetectedEntity(
        category=EntityCategory.NIP,
        start=second_start,
        end=second_start + len("526-10-40-828"),
        text="526-10-40-828",
        confidence=1.0,
        validation=ValidationStatus.PASSED,
    )

    result = anonymize(text, [first, second])

    assert result.anonymized_text == "NIP [NIP_1] oraz ponownie [NIP_1]."
    assert len(result.replacement_map.entries) == 1


def test_rejected_entities_are_not_replaced() -> None:
    text = "Jan Kowalski, PESEL 44051401359"
    rejected = _entity(text, "Jan Kowalski", EntityCategory.PERSON).model_copy(
        update={"status": "rejected"}
    )

    result = anonymize(text, [rejected, _entity(text, "44051401359", EntityCategory.PESEL)])

    assert result.anonymized_text == "Jan Kowalski, PESEL [PESEL_1]"
    assert [entry.token for entry in result.replacement_map.entries] == ["[PESEL_1]"]


def test_custom_category_falls_back_to_dane_prefix() -> None:
    text = "Numer klienta ABC-123"
    entity = _entity(text, "ABC-123", EntityCategory.EMAIL).model_copy(
        update={"category": "CUSTOM"}
    )

    result = anonymize(text, [entity])

    assert result.anonymized_text == "Numer klienta [DANE_1]"
    assert result.replacement_map.entries[0].category == "CUSTOM"


def test_deanonymize_restores_canonical_text_and_unknown_tokens_warn() -> None:
    text = "Rozmawiano z Janem Kowalskim."
    result = anonymize(
        text,
        [
            _entity(
                text,
                "Janem Kowalskim",
                EntityCategory.PERSON,
                canonical="Jan Kowalski",
                group="person-001",
            )
        ],
    )

    deanonymized = deanonymize(result.anonymized_text + " [OSOBA_99]", result.replacement_map)

    assert deanonymized.text == "Rozmawiano z Jan Kowalski. [OSOBA_99]"
    unknown_offset = (result.anonymized_text + " [OSOBA_99]").index("[OSOBA_99]")
    assert deanonymized.warnings == [
        f"Unknown anonymization token [OSOBA_99] at offset {unknown_offset}."
    ]


def test_deanonymize_leaves_non_token_brackets_untouched() -> None:
    replacement_map = ReplacementMap(entries=[], document_fingerprint="0" * 64)

    result = deanonymize("To jest [not-a-token] i [OSOBA_X].", replacement_map)

    assert result.text == "To jest [not-a-token] i [OSOBA_X]."
    assert result.warnings == []


def test_deanonymize_supports_multiword_token_prefixes() -> None:
    text = "KW GD1G/00012345/0"
    entity = _entity(text, "GD1G/00012345/0", EntityCategory.LAND_REGISTER)
    result = anonymize(text, [entity])

    assert result.anonymized_text == "KW [KSIEGA_WIECZYSTA_1]"
    assert deanonymize(result.anonymized_text, result.replacement_map) == text


def test_replacement_map_json_roundtrip() -> None:
    text = "Kontakt: anna.nowak@example.com"
    result = anonymize(text, [_entity(text, "anna.nowak@example.com", EntityCategory.EMAIL)])

    restored = ReplacementMap.from_json(result.replacement_map.to_json())

    assert restored == result.replacement_map


def test_anonymize_rejects_overlapping_spans() -> None:
    text = "Jan Kowalski"
    entities = [
        _entity(text, "Jan Kowalski", EntityCategory.PERSON),
        DetectedEntity(
            category=EntityCategory.PERSON,
            start=4,
            end=12,
            text="Kowalski",
            confidence=0.9,
            source="ner",
            validation=ValidationStatus.NOT_APPLICABLE,
        ),
    ]

    with pytest.raises(ValueError, match="Overlapping"):
        anonymize(text, entities)


def test_anonymize_rejects_invalid_span() -> None:
    text = "Jan Kowalski"
    entity = _entity(text, "Jan Kowalski", EntityCategory.PERSON).model_copy(update={"end": 99})

    with pytest.raises(ValueError, match="Invalid entity span"):
        anonymize(text, [entity])


def test_empty_entities_return_original_text_and_empty_map() -> None:
    result = anonymize("Bez danych osobowych.", [])

    assert result.anonymized_text == "Bez danych osobowych."
    assert result.replacement_map.entries == []


def test_map_handles_more_than_50_entities() -> None:
    values = [f"user{index:02d}@example.com" for index in range(60)]
    text = " ".join(values)
    entities = [_entity(text, value, EntityCategory.EMAIL) for value in values]

    result = anonymize(text, entities)

    assert len(result.replacement_map.entries) == 60
    assert result.replacement_map.entries[0].token == "[EMAIL_1]"
    assert result.replacement_map.entries[-1].token == "[EMAIL_60]"
    assert "[EMAIL_60]" in result.anonymized_text


def test_export_txt_returns_utf8_bytes() -> None:
    parsed = _parsed_document("Zażółć [OSOBA_1]")

    assert export_txt(parsed, parsed.text) == "Zażółć [OSOBA_1]".encode()


def test_export_docx_opens_with_parser_and_contains_tokens(tmp_path: Path) -> None:
    original = "Jan Kowalski\n\nPESEL 44051401359"
    parsed = ParsedDocument(
        text=original,
        blocks=[
            Block(start=0, end=12, kind="paragraph", page=None),
            Block(start=14, end=len(original), kind="paragraph", page=None),
        ],
        format="txt",
        has_text_layer=True,
        page_count=1,
    )
    result = anonymize(
        original,
        [
            _entity(original, "Jan Kowalski", EntityCategory.PERSON),
            _entity(original, "44051401359", EntityCategory.PESEL),
        ],
    )
    path = tmp_path / "anon.docx"
    path.write_bytes(export_docx(parsed, result.anonymized_text))

    reparsed = parse_document(path)

    assert "[OSOBA_1]" in reparsed.text
    assert "[PESEL_1]" in reparsed.text


def test_export_docx_reconstructs_simple_table_cells(tmp_path: Path) -> None:
    original = "Pole\tWartość\nPESEL\t44051401359"
    parsed = ParsedDocument(
        text=original,
        blocks=[
            Block(start=0, end=4, kind="table_cell", page=None),
            Block(start=5, end=12, kind="table_cell", page=None),
            Block(start=13, end=18, kind="table_cell", page=None),
            Block(start=19, end=30, kind="table_cell", page=None),
        ],
        format="docx",
        has_text_layer=True,
        page_count=1,
    )
    result = anonymize(original, [_entity(original, "44051401359", EntityCategory.PESEL)])
    path = tmp_path / "table.docx"
    path.write_bytes(export_docx(parsed, result.anonymized_text))

    reparsed = parse_document(path)

    assert "[PESEL_1]" in reparsed.text
    assert "Wartość" in reparsed.text


def test_export_pdf_contains_polish_characters_and_tokens(tmp_path: Path) -> None:
    original = "Zażółć gęślą jaźń dla Jana Kowalskiego."
    parsed = _parsed_document(original)
    result = anonymize(
        original,
        [
            _entity(
                original,
                "Jana Kowalskiego",
                EntityCategory.PERSON,
                canonical="Jan Kowalski",
            )
        ],
    )
    path = tmp_path / "anon.pdf"
    path.write_bytes(export_pdf(parsed, result.anonymized_text))

    with pdfplumber.open(path) as pdf:
        extracted = "\n".join(page.extract_text() or "" for page in pdf.pages)

    assert "Zażółć gęślą jaźń" in extracted
    assert "[OSOBA_1]" in extracted


def test_roundtrip_returns_canonical_text_for_inflected_variant() -> None:
    text = "Umowę zawarto z Janem Kowalskim, PESEL 44051401359."
    result = anonymize(
        text,
        [
            _entity(
                text,
                "Janem Kowalskim",
                EntityCategory.PERSON,
                canonical="Jan Kowalski",
                group="person-001",
            ),
            _entity(text, "44051401359", EntityCategory.PESEL),
        ],
    )

    deanonymized = deanonymize(result.anonymized_text, result.replacement_map)

    assert deanonymized == "Umowę zawarto z Jan Kowalski, PESEL 44051401359."
    assert deanonymized.warnings == []


def test_parse_detect_anonymize_deanonymize_roundtrip_on_corpus(tmp_path: Path) -> None:
    corpus_path = Path("../corpus/detection_eval.jsonl")
    record = json.loads(corpus_path.read_text(encoding="utf-8").splitlines()[0])
    path = tmp_path / "corpus.txt"
    path.write_text(record["text"], encoding="utf-8")
    parsed = parse_document(path)
    expected_entities = [
        DetectedEntity(
            category=EntityCategory(entity["category"]),
            start=entity["start"],
            end=entity["end"],
            text=parsed.text[entity["start"] : entity["end"]],
            confidence=0.9,
            source="ner",
            validation=ValidationStatus.NOT_APPLICABLE,
        )
        for entity in record["entities"]
    ]
    detected = detect_all(parsed.text, ner_engine=CorpusNerEngine(expected_entities))

    result = anonymize(parsed.text, detected.entities)
    deanonymized = deanonymize(result.anonymized_text, result.replacement_map)

    assert "[OSOBA_1]" in result.anonymized_text
    assert "[PESEL_1]" in result.anonymized_text
    assert deanonymized.text == parsed.text
    assert deanonymized.warnings == []


def test_document_fingerprint_is_sha256_of_original_text() -> None:
    text = "Jan Kowalski"
    result = anonymize(text, [_entity(text, "Jan Kowalski", EntityCategory.PERSON)])

    assert result.replacement_map.document_fingerprint == hashlib.sha256(
        text.encode("utf-8")
    ).hexdigest()


def _entity(
    text: str,
    value: str,
    category: EntityCategory,
    *,
    canonical: str | None = None,
    group: str | None = None,
) -> DetectedEntity:
    start = text.index(value)
    return DetectedEntity(
        category=category,
        start=start,
        end=start + len(value),
        text=value,
        confidence=1.0,
        source=(
            "ner"
            if category
            in {
                EntityCategory.PERSON,
                EntityCategory.COMPANY,
                EntityCategory.ADDRESS,
                EntityCategory.DATE,
            }
            else "regex"
        ),
        validation=(
            ValidationStatus.PASSED
            if category
            in {
                EntityCategory.PESEL,
                EntityCategory.NIP,
                EntityCategory.REGON,
                EntityCategory.ID_CARD,
                EntityCategory.BANK_ACCOUNT,
                EntityCategory.VEHICLE,
                EntityCategory.CASE_NUMBER,
            }
            else ValidationStatus.NOT_APPLICABLE
        ),
        entity_group_id=group,
        canonical_text=canonical,
    )


def _parsed_document(text: str) -> ParsedDocument:
    return ParsedDocument(
        text=text,
        blocks=[Block(start=0, end=len(text), kind="paragraph", page=None)],
        format="txt",
        has_text_layer=True,
        page_count=1,
    )
