from __future__ import annotations

import re
import time
from dataclasses import dataclass

import pytest

from anonymizer_engine.detection.dictionary import detect_dictionary
from anonymizer_engine.detection.models import DetectedEntity, EntityCategory, ValidationStatus
from anonymizer_engine.detection.pipeline import detect_all


@dataclass(frozen=True)
class Token:
    text: str
    idx: int
    lemma_: str
    is_sent_start: bool = False


class FakeNerEngine:
    def __init__(self, entities: list[DetectedEntity], tokens: list[Token]) -> None:
        self._entities = entities
        self.last_tokens = tokens

    def analyze(self, text: str, language: str) -> list[DetectedEntity]:
        assert language == "pl"
        return self._entities


def test_detects_adjacent_first_name_and_surname_as_one_person() -> None:
    text = "Umowę podpisał Jan Kowalski."

    entities = detect_dictionary(text, _doc(text, {"Jan": "jan", "Kowalski": "kowalski"}))

    assert _person_texts(entities) == ["Jan Kowalski"]
    assert entities[0].confidence == 0.95
    assert entities[0].source == "dictionary"


def test_detects_inflected_first_name_and_surname_bigram() -> None:
    text = "Pełnomocnikiem Jana Kowalskiego jest radca prawny."

    entities = detect_dictionary(
        text,
        _doc(text, {"Jana": "jan", "Kowalskiego": "kowalski"}),
    )

    assert _person_texts(entities) == ["Jana Kowalskiego"]


def test_detects_inflected_single_surname_with_lemma() -> None:
    text = "Doręczono pismo Kowalskiemu w dniu 5 maja."

    entities = detect_dictionary(text, _doc(text, {"Kowalskiemu": "kowalski"}))

    assert _person_texts(entities) == ["Kowalskiemu"]
    assert entities[0].confidence == 0.6


def test_detects_inflected_surname_with_suffix_fallback() -> None:
    text = "Rozmawiano z Nowakową przed rozprawą."

    entities = detect_dictionary(text, _doc(text))

    assert _person_texts(entities) == ["Nowakową"]


def test_does_not_detect_lowercase_homograph() -> None:
    text = "Spotkanie odbyło się w maju zeszłego roku."

    entities = detect_dictionary(text, _doc(text))

    assert entities == []


def test_does_not_detect_homograph_without_context_at_sentence_start() -> None:
    text = "Sroka to ptak."

    entities = detect_dictionary(text, _doc(text))

    assert entities == []


def test_detects_homograph_after_person_title() -> None:
    text = "Pan Maj podpisał protokół."

    entities = detect_dictionary(text, _doc(text))

    assert _person_texts(entities) == ["Maj"]


def test_detects_homograph_after_professional_title() -> None:
    text = "mec. Sroka wniósł odpowiedź na pozew."

    entities = detect_dictionary(text, _doc(text))

    assert _person_texts(entities) == ["Sroka"]


def test_titles_and_degrees_are_context_not_person_entities() -> None:
    text = "Prof. dr hab. n. med. Tomasz Zieliński oraz dr hab. n. med. Marek Lis."

    result = detect_all(
        text,
        ner_engine=FakeNerEngine(
            [
                _entity(text, "hab.", EntityCategory.PERSON),
                _entity(text, "n.", EntityCategory.PERSON),
                _entity(text, "Tomasz Zieliński", EntityCategory.PERSON),
                _entity(text, "Marek Lis", EntityCategory.PERSON),
            ],
            _doc(
                text,
                {
                    "Tomasz": "tomasz",
                    "Zieliński": "zieliński",
                    "Marek": "marek",
                    "Lis": "lis",
                },
            ),
        ),
    )

    assert [entity.text for entity in result.entities] == ["Tomasz Zieliński", "Marek Lis"]
    assert all(entity.category is EntityCategory.PERSON for entity in result.entities)


def test_city_names_are_not_detected_as_people() -> None:
    text = "dla miasta stołecznego Warszawy w Warszawie"

    result = detect_all(
        text,
        ner_engine=FakeNerEngine(
            [_entity(text, "Warszawy", EntityCategory.PERSON)],
            _doc(text),
        ),
    )

    assert [entity.category for entity in result.entities] == [
        EntityCategory.ADDRESS,
        EntityCategory.ADDRESS,
    ]
    assert [entity.text for entity in result.entities] == ["Warszawy", "Warszawie"]


def test_litigation_roles_are_not_people() -> None:
    text = "Pani Mecenas reprezentująca Powódkę"

    result = detect_all(
        text,
        ner_engine=FakeNerEngine(
            [
                _entity(text, "Mecenas", EntityCategory.PERSON),
                _entity(text, "Powódkę", EntityCategory.PERSON),
            ],
            _doc(text),
        ),
    )

    assert result.entities == []


def test_detects_homograph_after_initial() -> None:
    text = "J. Maj podpisał protokół."

    entities = detect_dictionary(text, _doc(text))

    assert _person_texts(entities) == ["Maj"]


def test_detects_surname_first_name_order_at_sentence_start() -> None:
    text = "Sroka Jan, ul. Polna 1."

    entities = detect_dictionary(text, _doc(text, {"Jan": "jan"}))

    assert _person_texts(entities) == ["Sroka Jan"]
    assert entities[0].confidence == 0.95


def test_detects_uppercase_first_name_and_surname() -> None:
    text = "Stawił się JAN KOWALSKI."

    entities = detect_dictionary(text, _doc(text, {"JAN": "jan", "KOWALSKI": "kowalski"}))

    assert _person_texts(entities) == ["JAN KOWALSKI"]


def test_detects_standalone_first_name_outside_sentence_start() -> None:
    text = "Spotkałem Annę przed sądem."

    entities = detect_dictionary(text, _doc(text, {"Annę": "anna"}))

    assert _person_texts(entities) == ["Annę"]
    assert entities[0].confidence == 0.5


def test_does_not_detect_standalone_first_name_at_sentence_start() -> None:
    text = "Anna podpisała umowę."

    entities = detect_dictionary(text, _doc(text, {"Anna": "anna"}))

    assert entities == []


def test_ner_confirmation_allows_homograph_and_merge_keeps_ner_source() -> None:
    text = "Maj podpisał protokół."
    start = text.index("Maj")
    ner_entity = DetectedEntity(
        category=EntityCategory.PERSON,
        start=start,
        end=start + len("Maj"),
        text="Maj",
        confidence=0.7,
        source="ner",
        validation=ValidationStatus.NOT_APPLICABLE,
    )

    result = detect_all(
        text,
        ner_engine=FakeNerEngine([ner_entity], _doc(text)),
    )

    assert len(result.entities) == 1
    assert result.entities[0].text == "Maj"
    assert result.entities[0].source == "ner"
    assert result.entities[0].corroborated_by == ["dictionary"]
    assert result.entities[0].confidence == 0.75


def test_dictionary_wins_category_conflict_with_ner() -> None:
    text = "Jan Kowalski podpisał umowę."
    start = text.index("Jan")
    ner_entity = DetectedEntity(
        category=EntityCategory.ADDRESS,
        start=start,
        end=start + len("Jan Kowalski"),
        text="Jan Kowalski",
        confidence=0.99,
        source="ner",
        validation=ValidationStatus.NOT_APPLICABLE,
    )

    result = detect_all(
        text,
        ner_engine=FakeNerEngine(
            [ner_entity],
            _doc(text, {"Jan": "jan", "Kowalski": "kowalski"}),
        ),
    )

    assert len(result.entities) == 1
    assert result.entities[0].category is EntityCategory.PERSON
    assert result.entities[0].source == "dictionary"


def test_loads_and_scans_one_mb_document_under_three_seconds() -> None:
    from anonymizer_engine.detection import dictionary

    dictionary._name_db.cache_clear()  # noqa: SLF001
    text = ("Ala ma kota. " * 80_000)[: 1024 * 1024]

    started_at = time.perf_counter()
    entities = detect_dictionary(text, None)
    elapsed = time.perf_counter() - started_at

    assert entities == []
    assert elapsed < 3.0


def test_corrupted_names_db_returns_readable_error(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from anonymizer_engine.detection import dictionary

    bad_db = tmp_path / "names.db"
    bad_db.write_text("not a sqlite database", encoding="utf-8")
    dictionary._name_db.cache_clear()  # noqa: SLF001
    monkeypatch.setattr(dictionary, "_default_db_path", lambda: bad_db)

    with pytest.raises(RuntimeError, match="Names database cannot be read"):
        detect_dictionary("Umowę podpisał Jan Kowalski.", None)

    dictionary._name_db.cache_clear()  # noqa: SLF001


def _entity(text: str, value: str, category: EntityCategory) -> DetectedEntity:
    start = text.index(value)
    return DetectedEntity(
        category=category,
        start=start,
        end=start + len(value),
        text=value,
        confidence=0.9,
        source="ner",
        validation=ValidationStatus.NOT_APPLICABLE,
    )


def _doc(text: str, lemmas: dict[str, str] | None = None) -> list[Token]:
    lemmas = lemmas or {}
    tokens: list[Token] = []
    for match in re.finditer(r"[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ-]+|[.]", text, re.UNICODE):
        token_text = match.group()
        tokens.append(
            Token(
                text=token_text,
                idx=match.start(),
                lemma_=lemmas.get(token_text, token_text),
                is_sent_start=_is_sentence_start(text, match.start()),
            )
        )
    return tokens


def _is_sentence_start(text: str, start: int) -> bool:
    prefix = text[:start].rstrip()
    return not prefix or prefix[-1] in ".!?"


def _person_texts(entities: list[DetectedEntity]) -> list[str]:
    return [entity.text for entity in entities if entity.category is EntityCategory.PERSON]
