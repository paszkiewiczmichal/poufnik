"""Full detection pipeline."""

from __future__ import annotations

import re
from collections.abc import Iterable
from functools import lru_cache

from anonymizer_engine.detection.companies import (
    detect_companies,
    downrank_unsupported_company_entities,
)
from anonymizer_engine.detection.consolidation import consolidate_entity_groups
from anonymizer_engine.detection.deterministic import detect_custom_rules, detect_deterministic
from anonymizer_engine.detection.dictionary import detect_dictionary, is_negative_person_text
from anonymizer_engine.detection.models import DetectedEntity, DetectionResult, EntityCategory
from anonymizer_engine.detection.ner import NerEngine, SpacyPresidioEngine
from anonymizer_engine.detection.places import detect_places, is_place_name
from anonymizer_engine.detection.public_institutions import detect_public_institutions

_POSTAL_CODE_RE = r"\d{2}-\d{3}"


def detect_all(
    text: str,
    language: str = "pl",
    ner_engine: NerEngine | None = None,
    custom_rules: list[dict[str, object]] | None = None,
) -> DetectionResult:
    """Detect deterministic, dictionary-backed and NER-backed entities in one pass."""
    deterministic_entities = detect_deterministic(text) + detect_custom_rules(text, custom_rules)
    company_entities = detect_companies(text, deterministic_entities)
    engine = ner_engine or _default_ner_engine()
    ner_entities = engine.analyze(text, language)
    tokens = getattr(engine, "last_tokens", None)
    ner_entities = _filter_ner_person_false_positives(text, ner_entities)
    public_entities = detect_public_institutions(text, tokens)
    ner_entities = downrank_unsupported_company_entities(
        text,
        ner_entities,
        company_entities,
        deterministic_entities,
    )
    dictionary_entities = [
        *detect_dictionary(text, tokens, ner_entities=ner_entities),
        *detect_places(text),
    ]

    regex_entities = [*deterministic_entities, *company_entities, *public_entities]
    entities = _merge_entities(regex_entities, dictionary_entities, ner_entities)
    entities = _merge_postal_address_clusters(text, entities)
    entities, groups = consolidate_entity_groups(entities, text, tokens)
    return DetectionResult(text=text, entities=entities, entity_groups=groups)


@lru_cache(maxsize=1)
def _default_ner_engine() -> SpacyPresidioEngine:
    return SpacyPresidioEngine()


def _merge_entities(
    deterministic_entities: Iterable[DetectedEntity],
    dictionary_entities: Iterable[DetectedEntity],
    ner_entities: Iterable[DetectedEntity],
) -> list[DetectedEntity]:
    selected: list[DetectedEntity] = []
    candidates = _corroborate_dictionary_and_ner(
        list(dictionary_entities),
        list(ner_entities),
    )
    candidates = list(deterministic_entities) + candidates
    for entity in sorted(candidates, key=_selection_key):
        if any(_overlaps(entity, existing) for existing in selected):
            continue
        selected.append(entity)
    return sorted(selected, key=lambda entity: (entity.start, entity.end, entity.category.value))


def _selection_key(entity: DetectedEntity) -> tuple[int, int, float, int]:
    source_priority = {"regex": 0, "dictionary": 1, "ner": 2, "manual": 3}[entity.source]
    return (source_priority, -(entity.end - entity.start), -entity.confidence, entity.start)


def _corroborate_dictionary_and_ner(
    dictionary_entities: list[DetectedEntity],
    ner_entities: list[DetectedEntity],
) -> list[DetectedEntity]:
    dictionary_by_span = {
        (entity.start, entity.end, entity.category): entity
        for entity in dictionary_entities
    }
    used_dictionary_spans: set[tuple[int, int, object]] = set()
    merged: list[DetectedEntity] = []

    for ner_entity in ner_entities:
        key = (ner_entity.start, ner_entity.end, ner_entity.category)
        dictionary_entity = dictionary_by_span.get(key)
        if dictionary_entity is None:
            merged.append(ner_entity)
            continue
        used_dictionary_spans.add(key)
        corroborated_by = list(dict.fromkeys([*ner_entity.corroborated_by, "dictionary"]))
        merged.append(
            ner_entity.model_copy(
                update={
                    "confidence": min(
                        0.99,
                        max(ner_entity.confidence, dictionary_entity.confidence) + 0.05,
                    ),
                    "corroborated_by": corroborated_by,
                }
            )
        )

    merged.extend(
        entity
        for entity in dictionary_entities
        if (entity.start, entity.end, entity.category) not in used_dictionary_spans
    )
    return merged


def _overlaps(left: DetectedEntity, right: DetectedEntity) -> bool:
    return left.start < right.end and right.start < left.end


def _filter_ner_person_false_positives(
    text: str,
    entities: list[DetectedEntity],
) -> list[DetectedEntity]:
    return [
        entity
        for entity in entities
        if not (
            entity.category is EntityCategory.PERSON
            and (
                is_negative_person_text(entity.text)
                or _person_entity_has_place_context(text, entity)
            )
        )
    ]


def _person_entity_has_place_context(text: str, entity: DetectedEntity) -> bool:
    if not is_place_name(entity.text):
        return False
    before = text[max(0, entity.start - 45) : entity.start]
    return bool(
        re.search(
            r"(?:^|[\s,(;:-])(?:w|we|miasta|miejscowości)\s+$"
            r"|(?:^|[\s,(;:-])dla\s+miasta(?:\s+[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ-]+)?\s+$",
            before,
            re.IGNORECASE,
        )
    )


def _merge_postal_address_clusters(
    text: str,
    entities: list[DetectedEntity],
) -> list[DetectedEntity]:
    result: list[DetectedEntity] = []
    index = 0
    sorted_entities = sorted(entities, key=lambda entity: (entity.start, entity.end))
    while index < len(sorted_entities):
        entity = sorted_entities[index]
        if entity.category is not EntityCategory.ADDRESS:
            result.append(entity)
            index += 1
            continue

        cluster = [entity]
        index += 1
        while index < len(sorted_entities):
            candidate = sorted_entities[index]
            if candidate.category is not EntityCategory.ADDRESS:
                break
            if not _address_gap_can_merge(text[cluster[-1].end : candidate.start]):
                break
            cluster.append(candidate)
            index += 1

        if len(cluster) > 1 and any(_is_postal_code(item.text) for item in cluster):
            result.append(_merged_address_entity(text, cluster))
        else:
            result.extend(cluster)
    return result


def _address_gap_can_merge(gap: str) -> bool:
    if len(gap) > 35:
        return False
    return bool(
        re.fullmatch(
            r"[\s,;:()/-]*(?:ul\.?|ulicy|al\.?|alei|pl\.?|placu|przy|w|we)?[\s,;:()/-]*",
            gap,
            re.IGNORECASE,
        )
    )


def _is_postal_code(value: str) -> bool:
    return bool(re.fullmatch(_POSTAL_CODE_RE, value.strip()))


def _merged_address_entity(text: str, cluster: list[DetectedEntity]) -> DetectedEntity:
    start = min(entity.start for entity in cluster)
    end = max(entity.end for entity in cluster)
    value = text[start:end]
    return DetectedEntity(
        category=EntityCategory.ADDRESS,
        start=start,
        end=end,
        text=value,
        confidence=max(entity.confidence for entity in cluster),
        source="dictionary" if any(entity.source == "dictionary" for entity in cluster) else "ner",
        validation=cluster[0].validation,
        entity_group_id=f"address:{value.casefold()}",
        canonical_text=value.strip(),
    )
