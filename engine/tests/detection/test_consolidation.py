from __future__ import annotations

from dataclasses import dataclass

from anonymizer_engine.detection.consolidation import consolidate_entity_groups
from anonymizer_engine.detection.models import DetectedEntity, EntityCategory, ValidationStatus


@dataclass(frozen=True)
class Token:
    text: str
    idx: int
    lemma_: str


def _entity(
    text: str,
    phrase: str,
    category: EntityCategory = EntityCategory.PERSON,
) -> DetectedEntity:
    start = text.index(phrase)
    return DetectedEntity(
        category=category,
        start=start,
        end=start + len(phrase),
        text=phrase,
        confidence=0.9,
        source="ner",
        validation=ValidationStatus.NOT_APPLICABLE,
    )


def _tokens(text: str, lemmas: dict[str, str]) -> list[Token]:
    tokens: list[Token] = []
    offset = 0
    for word in text.split():
        clean = word.strip(".,;:()")
        idx = text.index(clean, offset)
        tokens.append(Token(clean, idx, lemmas.get(clean, clean.lower())))
        offset = idx + len(clean)
    return tokens


def _grouped(entities: list[DetectedEntity]) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for entity in entities:
        if entity.entity_group_id:
            groups.setdefault(entity.entity_group_id, []).append(entity.text)
    return groups


def test_groups_person_genitive_with_nominative() -> None:
    text = "Jan Kowalski podpisał dokument. Pełnomocnikiem Jana Kowalskiego był radca."
    entities = [_entity(text, "Jan Kowalski"), _entity(text, "Jana Kowalskiego")]
    lemmas = {"Jan": "jan", "Kowalski": "kowalski", "Jana": "jan", "Kowalskiego": "kowalski"}

    grouped, groups = consolidate_entity_groups(entities, text, _tokens(text, lemmas))

    assert len(groups) == 1
    assert groups[0].canonical_text == "Jan Kowalski"
    assert grouped[1].entity_group_id == grouped[0].entity_group_id


def test_groups_person_instrumental_with_canonical_form() -> None:
    text = "Umowę zawarto z Janem Kowalskim."
    entities = [_entity(text, "Janem Kowalskim")]
    lemmas = {"Janem": "jan", "Kowalskim": "kowalski"}

    grouped, groups = consolidate_entity_groups(entities, text, _tokens(text, lemmas))

    assert groups[0].canonical_text == "Jan Kowalski"
    assert grouped[0].canonical_text == "Jan Kowalski"


def test_groups_dative_surname_with_full_person_when_unambiguous() -> None:
    text = "Jan Kowalski złożył podpis. Doręczono Kowalskiemu odpis pozwu."
    entities = [_entity(text, "Jan Kowalski"), _entity(text, "Kowalskiemu")]
    lemmas = {"Jan": "jan", "Kowalski": "kowalski", "Kowalskiemu": "kowalski"}

    grouped, _groups = consolidate_entity_groups(entities, text, _tokens(text, lemmas))

    assert grouped[0].entity_group_id == grouped[1].entity_group_id


def test_does_not_group_different_first_names_with_related_surnames() -> None:
    text = "Jan Kowalski i Anna Kowalska podpisali protokół."
    entities = [_entity(text, "Jan Kowalski"), _entity(text, "Anna Kowalska")]
    lemmas = {"Jan": "jan", "Kowalski": "kowalski", "Anna": "anna", "Kowalska": "kowalska"}

    grouped, groups = consolidate_entity_groups(entities, text, _tokens(text, lemmas))

    assert len(groups) == 2
    assert grouped[0].entity_group_id != grouped[1].entity_group_id


def test_groups_female_instrumental() -> None:
    text = "Anna Kowalska udzieliła zgody. Rozmawiano z Anną Kowalską."
    entities = [_entity(text, "Anna Kowalska"), _entity(text, "Anną Kowalską")]
    lemmas = {"Anna": "anna", "Kowalska": "kowalska", "Anną": "anna", "Kowalską": "kowalska"}

    grouped, groups = consolidate_entity_groups(entities, text, _tokens(text, lemmas))

    assert len(groups) == 1
    assert grouped[0].canonical_text == "Anna Kowalska"
    assert grouped[1].entity_group_id == grouped[0].entity_group_id


def test_groups_male_instrumental_with_non_ski_surname() -> None:
    text = "Piotr Nowak wystąpił w sprawie. Ugodę zawarto z Piotrem Nowakiem."
    entities = [_entity(text, "Piotr Nowak"), _entity(text, "Piotrem Nowakiem")]
    lemmas = {"Piotr": "piotr", "Nowak": "nowak", "Piotrem": "piotr", "Nowakiem": "nowak"}

    grouped, groups = consolidate_entity_groups(entities, text, _tokens(text, lemmas))

    assert len(groups) == 1
    assert grouped[0].entity_group_id == grouped[1].entity_group_id


def test_uses_conservative_levenshtein_fallback() -> None:
    text = "Jan Kowalski oraz Jana Kowalskego wskazano w aktach."
    entities = [_entity(text, "Jan Kowalski"), _entity(text, "Jana Kowalskego")]
    lemmas = {"Jan": "jan", "Kowalski": "kowalski", "Jana": "jan", "Kowalskego": "kowalskego"}

    grouped, groups = consolidate_entity_groups(entities, text, _tokens(text, lemmas))

    assert len(groups) == 1
    assert grouped[0].entity_group_id == grouped[1].entity_group_id


def test_groups_company_inflected_name() -> None:
    text = "Alfa Projekt sp. z o.o. zawarła umowę z Alfą Projekt sp. z o.o."
    entities = [
        _entity(text, "Alfa Projekt sp. z o.o.", EntityCategory.COMPANY),
        _entity(text, "Alfą Projekt sp. z o.o.", EntityCategory.COMPANY),
    ]
    lemmas = {
        "Alfa": "alfa",
        "Alfą": "alfa",
        "Projekt": "projekt",
        "sp": "sp",
        "z": "z",
        "oo": "oo",
    }

    grouped, groups = consolidate_entity_groups(entities, text, _tokens(text, lemmas))

    assert len(groups) == 1
    assert grouped[0].entity_group_id == grouped[1].entity_group_id


def test_does_not_group_distinct_companies() -> None:
    text = "Alfa Projekt sp. z o.o. i Beta Handel S.A. złożyły oferty."
    entities = [
        _entity(text, "Alfa Projekt sp. z o.o.", EntityCategory.COMPANY),
        _entity(text, "Beta Handel S.A.", EntityCategory.COMPANY),
    ]
    lemmas = {"Alfa": "alfa", "Projekt": "projekt", "Beta": "beta", "Handel": "handel"}

    grouped, groups = consolidate_entity_groups(entities, text, _tokens(text, lemmas))

    assert len(groups) == 2
    assert grouped[0].entity_group_id != grouped[1].entity_group_id


def test_ambiguous_surname_only_mention_stays_separate() -> None:
    text = "Jan Nowak i Anna Nowak byli obecni. Nowakowi doręczono pismo."
    entities = [_entity(text, "Jan Nowak"), _entity(text, "Anna Nowak"), _entity(text, "Nowakowi")]
    lemmas = {"Jan": "jan", "Anna": "anna", "Nowak": "nowak", "Nowakowi": "nowak"}

    grouped, groups = consolidate_entity_groups(entities, text, _tokens(text, lemmas))

    assert len(groups) == 3
    assert grouped[2].entity_group_id not in {
        grouped[0].entity_group_id,
        grouped[1].entity_group_id,
    }
