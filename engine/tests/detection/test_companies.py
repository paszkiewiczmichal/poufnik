from __future__ import annotations

import pytest

from anonymizer_engine.detection.companies import (
    detect_companies,
    downrank_unsupported_company_entities,
)
from anonymizer_engine.detection.deterministic import detect_deterministic
from anonymizer_engine.detection.models import DetectedEntity, EntityCategory, ValidationStatus
from anonymizer_engine.detection.pipeline import detect_all


@pytest.mark.parametrize(
    "legal_form",
    [
        "sp. z o.o.",
        "spółka z ograniczoną odpowiedzialnością",
        "S.A.",
        "spółka akcyjna",
        "P.S.A.",
        "prosta spółka akcyjna",
        "sp.k.",
        "spółka komandytowa",
        "S.K.A.",
        "sp.j.",
        "spółka jawna",
        "sp.p.",
        "spółka partnerska",
        "sp. z o.o. sp.k.",
    ],
)
def test_detects_polish_legal_forms(legal_form: str) -> None:
    text = f"Umowę zawarła Alfa Beta {legal_form} z Warszawy."

    companies = detect_companies(text)

    assert _company_texts(companies) == [f"Alfa Beta {legal_form}"]
    assert companies[0].confidence == 0.95
    assert companies[0].source == "regex"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Umowę zawarto z Alfa sp. z o.o. w Warszawie.", "Alfa sp. z o.o."),
        ("Zapłacono Alfie sp. z o.o. w terminie.", "Alfie sp. z o.o."),
        ("Dostawcą jest „Gamma-Tech” S.A. z Krakowa.", "„Gamma-Tech” S.A."),
        ("Dostawcą jest PHU Alfa-Beta sp.k. z KRS 0000123456.", "PHU Alfa-Beta sp.k."),
        ("Partnerem jest Kowalski i Wspólnicy sp.k.", "Kowalski i Wspólnicy sp.k."),
    ],
)
def test_detects_inflected_quoted_acronym_and_partner_names(
    text: str,
    expected: str,
) -> None:
    assert _company_texts(detect_companies(text, detect_deterministic(text))) == [expected]


def test_detects_company_name_before_business_identifier() -> None:
    text = "Dostawca Alfa Logistics, NIP 526-10-40-828, wykona usługę."

    companies = detect_companies(text, detect_deterministic(text))

    assert _company_texts(companies) == ["Alfa Logistics"]
    assert companies[0].confidence == 0.8


def test_detects_organization_form_and_alias_group() -> None:
    text = (
        "Krajowym Towarzystwem Chirurgów Naczyniowych, zwanym dalej „KTCN” "
        "lub „Towarzystwem”. KTCN prowadzi rejestr."
    )

    result = detect_all(text, ner_engine=_NoopNer())
    companies = [entity for entity in result.entities if entity.category is EntityCategory.COMPANY]

    assert [entity.text for entity in companies] == [
        "Krajowym Towarzystwem Chirurgów Naczyniowych",
        "KTCN",
        "KTCN",
    ]
    assert len({entity.entity_group_id for entity in companies}) == 1
    assert all(
        entity.canonical_text == "Krajowym Towarzystwem Chirurgów Naczyniowych"
        for entity in companies
    )


def test_generic_alias_is_not_tokenized_as_company() -> None:
    text = "Krajowym Towarzystwem Chirurgów Naczyniowych, zwanym dalej „Towarzystwem”."

    result = detect_all(text, ner_engine=_NoopNer())

    assert _company_texts(result.entities) == [
        "Krajowym Towarzystwem Chirurgów Naczyniowych"
    ]


def test_detects_journal_and_conference_names_from_context() -> None:
    text = "wydawca czasopisma „Flebologia Kliniczna” oraz organizator konferencji Naczynia 2026"

    companies = detect_companies(text)

    assert _company_texts(companies) == ["„Flebologia Kliniczna”", "Naczynia 2026"]
    assert all(entity.confidence == 0.7 for entity in companies)


def test_downranks_ner_company_without_support() -> None:
    text = "W dokumencie wspomniano o Zielonym Rynku."
    start = text.index("Zielonym Rynku")
    entity = _entity(text, start, start + len("Zielonym Rynku"), EntityCategory.COMPANY)

    [updated] = downrank_unsupported_company_entities(text, [entity], [], [])

    assert updated.confidence == 0.5


def test_keeps_supported_ner_company_confidence() -> None:
    text = "Alfa z siedzibą w Warszawie podpisała umowę."
    start = text.index("Alfa")
    entity = _entity(text, start, start + len("Alfa"), EntityCategory.COMPANY)

    [updated] = downrank_unsupported_company_entities(text, [entity], [], [])

    assert updated.confidence == 0.91


def test_company_root_consolidates_legal_form_and_short_name() -> None:
    text = "Alfa sp. z o.o. podpisała umowę. Alfa wykona usługę."
    first_start = text.index("Alfa sp. z o.o.")
    second_start = text.rindex("Alfa")

    class Ner:
        last_tokens = []

        def analyze(self, _text: str, _language: str) -> list[DetectedEntity]:
            return [
                _entity(text, second_start, second_start + len("Alfa"), EntityCategory.COMPANY)
            ]

    result = detect_all(text, ner_engine=Ner())
    companies = [entity for entity in result.entities if entity.category is EntityCategory.COMPANY]

    assert [entity.text for entity in companies] == ["Alfa sp. z o.o.", "Alfa"]
    assert len({entity.entity_group_id for entity in companies}) == 1
    assert companies[0].start == first_start


class _NoopNer:
    last_tokens = []

    def analyze(self, _text: str, _language: str) -> list[DetectedEntity]:
        return []


def _company_texts(entities: list[DetectedEntity]) -> list[str]:
    return [entity.text for entity in entities if entity.category is EntityCategory.COMPANY]


def _entity(
    text: str,
    start: int,
    end: int,
    category: EntityCategory,
) -> DetectedEntity:
    return DetectedEntity(
        category=category,
        start=start,
        end=end,
        text=text[start:end],
        confidence=0.91,
        source="ner",
        validation=ValidationStatus.NOT_APPLICABLE,
    )
