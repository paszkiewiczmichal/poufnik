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
    is_generic_court_reference,
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


@pytest.mark.parametrize(
    "text, expected",
    [
        ("SĄD REJONOWY W GDAŃSKU\nWYROK", "SĄD REJONOWY W GDAŃSKU"),
        (
            "Sąd Okręgowy w Warszawie, XXV Wydział Cywilny, wydał wyrok.",
            "Sąd Okręgowy w Warszawie, XXV Wydział Cywilny",
        ),
        (
            "Sąd Okręgowy w Warszawie XXV Wydział Cywilny wydał wyrok.",
            "Sąd Okręgowy w Warszawie XXV Wydział Cywilny",
        ),
        (
            "Sąd Okręgowy w Warszawie\nXXV Wydział Cywilny\nWYROK",
            "Sąd Okręgowy w Warszawie\nXXV Wydział Cywilny",
        ),
        (
            "prowadzonego przez Sąd Rejonowy Gdańsk-Północ w Gdańsku, VII Wydział "
            "Gospodarczy Krajowego Rejestru Sądowego, pod numerem KRS",
            "Sąd Rejonowy Gdańsk-Północ w Gdańsku, VII Wydział "
            "Gospodarczy Krajowego Rejestru Sądowego",
        ),
        ("Sądowi Okręgowemu w Gdańsku przekazano akta.", "Sądowi Okręgowemu w Gdańsku"),
        (
            "Wojewódzki Sąd Administracyjny w Gdańsku oddalił skargę.",
            "Wojewódzki Sąd Administracyjny w Gdańsku",
        ),
    ],
)
def test_named_court_span_stays_within_court_seat_and_division(text: str, expected: str) -> None:
    # Sąd z miejscowością (i ewentualnym wydziałem) jest maskowany jako jedna encja, ale
    # nazwa nie może przejść przez złamanie wiersza na kolejny nagłówek ("WYROK").
    assert [entity.text for entity in detect_named_courts(text)] == [expected]


@pytest.mark.parametrize(
    "text",
    [
        "SĄD REJONOWY\nWYROK\nW IMIENIU RZECZYPOSPOLITEJ POLSKIEJ",
        "SĄD REJONOWY\nW IMIENIU RZECZYPOSPOLITEJ POLSKIEJ",
        "Sąd Rejonowy Wydział Cywilny oddalił powództwo.",
        "Sąd Okręgowy I Wydział Cywilny oddalił apelację.",
        "Sąd Okręgowy jako sąd odwoławczy rozpoznał apelację.",
    ],
)
def test_court_without_location_is_not_a_named_court(text: str) -> None:
    assert detect_named_courts(text) == []


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Urząd Skarbowy w Gdańsku\nJan Kowalski", "Urząd Skarbowy w Gdańsku"),
        ("Ministerstwo Zdrowia\nJan Kowalski", "Ministerstwo Zdrowia"),
    ],
)
def test_public_institution_does_not_swallow_next_line(text: str, expected: str) -> None:
    # Wcześniej nazwisko z następnego wiersza trafiało do odrzuconej (jawnej)
    # instytucji publicznej i nie było maskowane.
    assert [entity.text for entity in detect_public_institutions(text)] == [expected]


@pytest.mark.parametrize(
    "value",
    [
        "Sąd",
        "SĄD\n",
        "Sądu Okręgowego",
        "Sądowi Okręgowemu",
        "Sądem Apelacyjnym",
        "Wysoki Sądzie",
        "Sąd I instancji",
        "Sąd pierwszej instancji",
        "sąd odwoławczy",
        "I Wydział Cywilny",
        "XXV Wydział Cywilny",
        "Wydziału Cywilnego",
        "IV Wydział Pracy i Ubezpieczeń Społecznych",
        "Gospodarczy Krajowego Rejestru Sądowego",
    ],
)
def test_generic_court_reference_is_recognized(value: str) -> None:
    assert is_generic_court_reference(value)


@pytest.mark.parametrize(
    "value",
    [
        "Sąd Rejonowy w Gdańsku",
        "Sąd Rejonowy Gdańsk-Północ",
        "Sąd Okręgowy w Warszawie XXV Wydział Cywilny",
        "Kancelaria Przykład sp. z o.o.",
        "Jan Kowalski",
        "Krajowego Rejestru",
        "Wysoki",
        "II",
    ],
)
def test_specific_names_are_not_generic_court_references(value: str) -> None:
    assert not is_generic_court_reference(value)


def test_generic_court_mentions_tagged_by_ner_are_dropped_but_real_entities_stay() -> None:
    text = (
        "W ocenie Sądu Okręgowego apelacja Jana Kowalskiego przeciwko Kancelaria "
        "Przykład sp. z o.o. nie zasługuje na uwzględnienie. Sąd Rejonowy w Gdańsku, "
        "I Wydział Cywilny, wydał wyrok. Wysoki Sądzie, wnoszę jak na wstępie."
    )

    class Ner:
        last_tokens = []

        def analyze(self, _text: str, _language: str) -> list[DetectedEntity]:
            return [
                _entity_at(text, "Sądu Okręgowego", EntityCategory.COMPANY),
                _entity_at(text, "Jana Kowalskiego", EntityCategory.PERSON),
                _entity_at(text, "I Wydział Cywilny", EntityCategory.COMPANY),
                _entity_at(text, "Sądzie", EntityCategory.COMPANY),
            ]

    result = detect_all(text, ner_engine=Ner())

    assert [(entity.category, entity.text) for entity in result.entities] == [
        (EntityCategory.PERSON, "Jana Kowalskiego"),
        (EntityCategory.COMPANY, "Przykład sp. z o.o."),
        (EntityCategory.COMPANY, "Sąd Rejonowy w Gdańsku, I Wydział Cywilny"),
    ]


def test_generic_division_before_krs_number_is_not_a_company() -> None:
    # Regex "nazwa firmy przed numerem KRS" brał wcześniej sam opis wydziału za firmę.
    text = "wpisana przez VII Wydział Gospodarczy Krajowego Rejestru Sądowego, KRS 0000123456."

    result = detect_all(text, ner_engine=_NoopNer())

    assert [entity.category for entity in result.entities] == [EntityCategory.KRS]


def _real_ner_available() -> bool:
    from anonymizer_engine.detection.ner import spacy_model_available

    return spacy_model_available()


@pytest.mark.skipif(
    not _real_ner_available(),
    reason="pl_core_news_lg model is required to exercise the real NER engine offline.",
)
@pytest.mark.parametrize(
    "text, expected",
    [
        ("W ocenie Sądu Okręgowego apelacja nie zasługuje na uwzględnienie.", []),
        ("Sąd Apelacyjny oddalił apelację. Sądowi znane są okoliczności.", []),
        ("Wysoki Sądzie, wnoszę o oddalenie powództwa.", []),
        ("SĄD\nustalił, że pozwany nie zapłacił.", []),
        ("Sąd Okręgowy jako sąd odwoławczy rozpoznał apelację.", []),
        ("Sprawa trafiła do Wydziału Cywilnego.", []),
        ("II Wydział Karny rozpoznał sprawę.", []),
        (
            "Sąd Rejonowy w Gdańsku, I Wydział Cywilny, wydał wyrok.",
            [(EntityCategory.COMPANY, "Sąd Rejonowy w Gdańsku, I Wydział Cywilny")],
        ),
        (
            "Jan Kowalski pozwał Kancelaria Przykład sp. z o.o. przed Sądem Okręgowym.",
            [
                (EntityCategory.PERSON, "Jan Kowalski"),
                (EntityCategory.COMPANY, "Przykład sp. z o.o."),
            ],
        ),
    ],
)
def test_real_ner_does_not_mask_generic_court_mentions(
    text: str,
    expected: list[tuple[EntityCategory, str]],
) -> None:
    result = detect_all(text, language="pl")

    sensitive = [
        (entity.category, entity.text)
        for entity in result.entities
        if entity.status is EntityStatus.ACCEPTED
    ]
    assert sensitive == expected


@pytest.mark.parametrize(
    "text, wrong_address",
    [
        ("SĄD REJONOWY\nWYROK\nW IMIENIU RZECZYPOSPOLITEJ POLSKIEJ", "IMIENIU RZECZYPOSPOLITEJ"),
        ("Wyrok w imieniu Rzeczypospolitej Polskiej", "Rzeczypospolitej Polskiej"),
    ],
)
def test_judgment_formula_in_the_name_of_the_republic_is_not_masked(
    text: str,
    wrong_address: str,
) -> None:
    # Prawdziwy NER oznaczał te fragmenty formuły wyroku jako ADDRESS.
    class Ner:
        last_tokens = []

        def analyze(self, _text: str, _language: str) -> list[DetectedEntity]:
            return [_entity_at(text, wrong_address, EntityCategory.ADDRESS)]

    result = detect_all(text, ner_engine=Ner())

    assert [(entity.category, entity.text.casefold()) for entity in result.entities] == [
        (EntityCategory.PUBLIC_INSTITUTION, "rzeczypospolitej polskiej")
    ]
    assert result.entities[0].status is EntityStatus.REJECTED


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


def _entity_at(text: str, value: str, category: EntityCategory) -> DetectedEntity:
    start = text.index(value)
    return _entity(text, start, start + len(value), category)


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
