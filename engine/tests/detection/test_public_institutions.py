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
    detect_named_courts,
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


@pytest.mark.parametrize(
    "text",
    [
        "Odwołanie wniesiono przed Sądem Okręgowym w Gdańsku.",
        "Pozew złożono w Sądzie Rejonowym dla Warszawy Mokotowa.",
        "Akta są prowadzone przez Sąd Rejonowy Gdańsk-Północ, VIII Wydział Gospodarczy KRS.",
        "Skargę rozpozna Wojewódzki Sąd Administracyjny w Krakowie.",
        "Sąd Apelacyjny w Szczecinie\nI Wydział Cywilny",
    ],
)
def test_named_courts_are_not_rejected_as_public_institutions(text: str) -> None:
    # Sąd Najwyższy/NSA (apex courts, bez lokalizacji) zostają publiczne - ale konkretny
    # sąd rozpoznający sprawę razem z sygnaturą akt wystarczy do znalezienia sprawy w
    # publicznym rejestrze, więc ma trafić do maskowania jak każda inna dana wrażliwa.
    institutions = detect_public_institutions(text)

    assert institutions == []


@pytest.mark.parametrize(
    "text, expected",
    [
        (
            "Odwołanie wniesiono przed Sądem Okręgowym w Gdańsku.",
            "Sądem Okręgowym w Gdańsku",
        ),
        (
            "Skargę rozpozna Wojewódzki Sąd Administracyjny w Krakowie.",
            "Wojewódzki Sąd Administracyjny w Krakowie",
        ),
        ("Sąd Apelacyjny w Szczecinie", "Sąd Apelacyjny w Szczecinie"),
    ],
)
def test_detect_named_courts_returns_sensitive_company_entity(text: str, expected: str) -> None:
    courts = detect_named_courts(text)

    assert len(courts) == 1
    assert courts[0].text == expected
    assert courts[0].category is EntityCategory.COMPANY
    assert courts[0].status is EntityStatus.ACCEPTED
    assert courts[0].source == "regex"


def test_named_court_masks_whole_span_not_just_the_city() -> None:
    # Bez source="regex"/priorytetu pełnego dopasowania, słownikowy detektor miast
    # ("w Szczecinie") wygrałby z krótszym zasięgiem i zamaskowałby samo miasto,
    # zostawiając "Sąd Apelacyjny w [...] Wydział Cywilny" w tekście jawnym.
    text = "Sąd Apelacyjny w Szczecinie\nI Wydział Cywilny"

    result = detect_all(text, ner_engine=_NoopNer())

    company_entities = [e for e in result.entities if e.category is EntityCategory.COMPANY]
    assert [e.text for e in company_entities] == [
        "Sąd Apelacyjny w Szczecinie\nI Wydział Cywilny"
    ]


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
    text = "Pozew przeciwko Alfa sp. z o.o. złożono; sprawę komentował Parlament Europejski."

    class Ner:
        last_tokens = []

        def analyze(self, _text: str, _language: str) -> list[DetectedEntity]:
            parliament_start = text.index("Parlament Europejski")
            return [
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
    assert by_category[EntityCategory.PUBLIC_INSTITUTION] == ["Parlament Europejski"]
    assert all(
        entity.status is EntityStatus.REJECTED
        for entity in result.entities
        if entity.category is EntityCategory.PUBLIC_INSTITUTION
    )


def test_named_court_wrongly_tagged_by_ner_stays_masked_as_company() -> None:
    # Sąd Okręgowy w Gdańsku nie jest już traktowany jako instytucja publiczna
    # (patrz test_named_courts_are_not_rejected_as_public_institutions) - powinien
    # więc trafić do maskowania tak samo jak realna nazwa firmy/organizacji.
    text = "Odwołanie wniesiono przed Sądem Okręgowym w Gdańsku."

    class Ner:
        last_tokens = []

        def analyze(self, _text: str, _language: str) -> list[DetectedEntity]:
            court_start = text.index("Sądem Okręgowym w Gdańsku")
            return [
                _entity(
                    text,
                    court_start,
                    court_start + len("Sądem Okręgowym w Gdańsku"),
                    EntityCategory.COMPANY,
                ),
            ]

    result = detect_all(text, ner_engine=Ner())

    assert [entity.category for entity in result.entities] == [EntityCategory.COMPANY]
    assert result.entities[0].text == "Sądem Okręgowym w Gdańsku"


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
