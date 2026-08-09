from __future__ import annotations

from dataclasses import dataclass

import pytest

from anonymizer_engine.detection.models import (
    DetectedEntity,
    EntityCategory,
    EntityStatus,
    ValidationStatus,
)
from anonymizer_engine.detection.pipeline import detect_all
from anonymizer_engine.detection.public_institutions import (
    curated_public_institution_count,
    detect_public_institutions,
)


@dataclass(frozen=True)
class Token:
    text: str
    idx: int
    lemma_: str


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Decyzją Komisji Europejskiej zakończono postępowanie.", "Komisji Europejskiej"),
        ("Sprawę komentował Parlament Europejski.", "Parlament Europejski"),
        ("Pomoc finansuje Unia Europejska.", "Unia Europejska"),
        (
            "Odwołanie wniesiono przed Sądem Okręgowym w Gdańsku.",
            "Sądem Okręgowym w Gdańsku",
        ),
        (
            "Pozew złożono w Sądzie Rejonowym dla Warszawy Mokotowa.",
            "Sądzie Rejonowym dla Warszawy Mokotowa",
        ),
        (
            "Akta są prowadzone przez Sąd Rejonowy Gdańsk-Północ, "
            "VIII Wydział Gospodarczy KRS.",
            "Sąd Rejonowy Gdańsk-Północ, VIII Wydział Gospodarczy KRS",
        ),
        (
            "Skargę rozpozna Wojewódzki Sąd Administracyjny w Krakowie.",
            "Wojewódzki Sąd Administracyjny w Krakowie",
        ),
        ("Akta prowadzi Prokuratura Rejonowa w Poznaniu.", "Prokuratura Rejonowa w Poznaniu"),
        ("Pismo wysłano do Urzędu Skarbowego w Gdyni.", "Urzędu Skarbowego w Gdyni"),
        ("Wniosek złożono w Urzędzie Miasta Gdańska.", "Urzędzie Miasta Gdańska"),
        (
            "Kontrolę prowadzi Komenda Wojewódzka Policji w Łodzi.",
            "Komenda Wojewódzka Policji w Łodzi",
        ),
    ],
)
def test_detects_public_institutions_and_rejects_by_default(
    text: str,
    expected: str,
) -> None:
    institutions = detect_public_institutions(text)

    assert [entity.text for entity in institutions] == [expected]
    assert institutions[0].category is EntityCategory.PUBLIC_INSTITUTION
    assert institutions[0].status is EntityStatus.REJECTED


def test_curated_public_institution_list_has_required_size() -> None:
    assert curated_public_institution_count() >= 150


def test_lemma_phrase_detection_handles_inflection() -> None:
    text = "Decyzją Komisji Europejskiej uchylono rozstrzygnięcie."
    start = text.index("Komisji")
    tokens = [
        Token("Decyzją", 0, "decyzja"),
        Token("Komisji", start, "komisja"),
        Token("Europejskiej", start + len("Komisji "), "europejski"),
    ]

    institutions = detect_public_institutions(text, tokens)

    assert any(entity.text == "Komisji Europejskiej" for entity in institutions)


def test_public_institution_wins_over_wrong_ner_person_and_company() -> None:
    text = (
        "Pozew przeciwko Alfa sp. z o.o. złożono w Sądzie Okręgowym w Gdańsku; "
        "sprawę komentował Parlament Europejski."
    )

    class Ner:
        last_tokens = []

        def analyze(self, _text: str, _language: str) -> list[DetectedEntity]:
            court_start = text.index("Sądzie Okręgowym w Gdańsku")
            parliament_start = text.index("Parlament Europejski")
            return [
                _entity(
                    text,
                    court_start,
                    court_start + len("Sądzie Okręgowym w Gdańsku"),
                    EntityCategory.PERSON,
                ),
                _entity(
                    text,
                    parliament_start,
                    parliament_start + len("Parlament Europejski"),
                    EntityCategory.COMPANY,
                ),
            ]

    result = detect_all(text, ner_engine=Ner())
    by_category = {entity.category: [] for entity in result.entities}
    for entity in result.entities:
        by_category.setdefault(entity.category, []).append(entity.text)

    assert by_category[EntityCategory.COMPANY] == ["Alfa sp. z o.o."]
    assert by_category[EntityCategory.PUBLIC_INSTITUTION] == [
        "Sądzie Okręgowym w Gdańsku",
        "Parlament Europejski",
    ]
    assert EntityCategory.PERSON not in by_category
    assert all(
        entity.status is EntityStatus.REJECTED
        for entity in result.entities
        if entity.category is EntityCategory.PUBLIC_INSTITUTION
    )


def test_state_owned_company_with_legal_form_stays_company() -> None:
    text = "Usługę wykonała Poczta Polska S.A."

    result = detect_all(text, ner_engine=_NoopNer())
    categories = {entity.text: entity.category for entity in result.entities}

    assert categories == {"Poczta Polska S.A.": EntityCategory.COMPANY}


class _NoopNer:
    last_tokens: list[Token] = []

    def analyze(self, _text: str, _language: str) -> list[DetectedEntity]:
        return []


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
        confidence=0.92,
        source="ner",
        validation=ValidationStatus.NOT_APPLICABLE,
    )
