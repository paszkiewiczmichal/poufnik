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
from anonymizer_engine.detection.models import (
    DetectedEntity,
    DetectionResult,
    EntityCategory,
    EntityStatus,
)
from anonymizer_engine.detection.ner import NerEngine, SpacyPresidioEngine
from anonymizer_engine.detection.places import detect_places, has_address_context, is_place_name
from anonymizer_engine.detection.public_institutions import (
    detect_named_courts,
    detect_public_institutions,
    is_generic_court_reference,
)

_POSTAL_CODE_RE = r"\d{2}-\d{3}"
# PKD (Polska Klasyfikacja Działalności) business-activity codes are written like
# "73.20.Z" and commonly wrapped in slashes in statutes/articles of association, e.g.
# "/73.20.Z/, 9) pozostałe [...]". The NER model sometimes tags just the leading
# "/73" as ADDRESS because it resembles a street-number suffix.
_PKD_CODE_SUFFIX_RE = re.compile(r"^\.\d{2}\.[A-Z]\b")
# Words that NER tags as names in printed e-mails and calendar lines ("Monday, October 5",
# "Central European Summer Time", "Temat: Prośba o ...", "contract.PDF"). An entity made
# only of these words identifies nobody.
_NOT_A_NAME_WORDS = {
    *(
        "monday tuesday wednesday thursday friday saturday sunday "
        "january february march april may june july august september october november "
        "december"
    ).split(),
    *"summer winter standard daylight time central european eastern western zone".split(),
    *"gmt utc cet cest est pst".split(),
    *"temat prośba pytanie zapytanie wiadomość odpowiedź załącznik załączniki".split(),
    *"subject from sent cc bcc fwd fw re odp pozdrawiam".split(),
    *"pdf docx doc jpg jpeg png xlsx xls zip".split(),
}
_NAME_WORD_RE = re.compile(r"[^\W\d_]+")
# "Justyna Ł." - a first name followed by the initial of the surname.
_TRAILING_INITIAL_RE = re.compile(r" [A-ZĄĆĘŁŃÓŚŹŻ]\.")
# "Kancelaria Radcy Prawnego Jan Kowalski" is one firm named after its owner.
_LAW_FIRM_PREFIX_RE = re.compile(
    r"Kancelari[a-ząęółśżźćń]*\s+(?:Radc[a-ząęółśżźćń]*\s+Prawn[a-ząęółśżźćń]*"
    r"|Adwokack[a-ząęółśżźćń]*|Adwokat[a-ząęółśżźćń]*|Notarialn[a-ząęółśżźćń]*"
    r"|Prawn[a-ząęółśżźćń]*)$"
)


def detect_all(
    text: str,
    language: str = "pl",
    ner_engine: NerEngine | None = None,
    custom_rules: list[dict[str, object]] | None = None,
) -> DetectionResult:
    """Detect deterministic, dictionary-backed and NER-backed entities in one pass."""
    deterministic_entities = detect_deterministic(text) + detect_custom_rules(text, custom_rules)
    company_entities = _filter_generic_court_companies(
        detect_companies(text, deterministic_entities)
    )
    engine = ner_engine or _default_ner_engine()
    ner_entities = engine.analyze(text, language)
    tokens = getattr(engine, "last_tokens", None)
    ner_entities = _filter_ner_person_false_positives(text, ner_entities)
    ner_entities = _filter_ner_address_false_positives(text, ner_entities)
    ner_entities = _filter_generic_court_companies(ner_entities)
    public_entities = detect_public_institutions(text, tokens)
    court_entities = detect_named_courts(text)
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

    regex_entities = [
        *deterministic_entities,
        *company_entities,
        *public_entities,
        *court_entities,
    ]
    entities = _merge_entities(regex_entities, dictionary_entities, ner_entities)
    entities = [entity for entity in entities if not _is_not_a_name(entity)]
    entities = _merge_law_firm_owner_names(text, _extend_trailing_initials(text, entities))
    entities = _merge_postal_address_clusters(text, entities)
    entities = _propagate_repeated_names(text, entities)
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


def _filter_ner_address_false_positives(
    text: str,
    entities: list[DetectedEntity],
) -> list[DetectedEntity]:
    return [
        entity
        for entity in entities
        if not (
            entity.category is EntityCategory.ADDRESS
            and (
                _address_entity_is_pkd_code_fragment(text, entity)
                # A lone lowercase word ("środkowoeuropejski") is never an address.
                or re.fullmatch(r"[a-ząćęłńóśźż-]+", entity.text) is not None
            )
        )
    ]


def _is_not_a_name(entity: DetectedEntity) -> bool:
    if entity.category not in {
        EntityCategory.PERSON,
        EntityCategory.COMPANY,
        EntityCategory.ADDRESS,
    }:
        return False
    words = [word.casefold() for word in _NAME_WORD_RE.findall(entity.text)]
    return bool(words) and all(word in _NOT_A_NAME_WORDS for word in words)


def _extend_trailing_initials(text: str, entities: list[DetectedEntity]) -> list[DetectedEntity]:
    """Take the surname initial into the person: "Justyna Ł." must not leave "Ł." behind."""
    taken = [(entity.start, entity.end) for entity in entities]
    result: list[DetectedEntity] = []
    for entity in entities:
        match = _TRAILING_INITIAL_RE.match(text, entity.end)
        if (
            entity.category is EntityCategory.PERSON
            and match
            and not any(start < match.end() and entity.end < end for start, end in taken)
        ):
            entity = entity.model_copy(
                update={"end": match.end(), "text": text[entity.start : match.end()]}
            )
        result.append(entity)
    return result


def _propagate_repeated_names(text: str, entities: list[DetectedEntity]) -> list[DetectedEntity]:
    """Mark every other exact occurrence of a detected person or company name.

    NER misses a name in some sentences ("klienta JDN") while finding it in others; one
    unmasked mention would reveal what every token stands for.
    """
    names: dict[str, DetectedEntity] = {}
    for entity in entities:
        if (
            entity.category in {EntityCategory.PERSON, EntityCategory.COMPANY}
            and entity.status is not EntityStatus.REJECTED
            and len(entity.text) >= 3
            and entity.text[0].isupper()
        ):
            names.setdefault(entity.text, entity)
    if not names:
        return entities
    taken = sorted((entity.start, entity.end) for entity in entities)
    added: list[DetectedEntity] = []
    pattern = re.compile(
        r"(?<!\w)(?:" + "|".join(re.escape(name) for name in sorted(names, key=len, reverse=True))
        + r")(?!\w)"
    )
    for match in pattern.finditer(text):
        if any(start < match.end() and match.start() < end for start, end in taken):
            continue
        source = names[match.group()]
        added.append(
            source.model_copy(
                update={
                    "start": match.start(),
                    "end": match.end(),
                    "entity_group_id": None,
                    "canonical_text": None,
                }
            )
        )
    return sorted([*entities, *added], key=lambda item: (item.start, item.end))


def _merge_law_firm_owner_names(
    text: str, entities: list[DetectedEntity]
) -> list[DetectedEntity]:
    """Join "Kancelaria Radcy Prawnego" and the owner's name that follows into one firm."""
    ordered = sorted(entities, key=lambda item: (item.start, item.end))
    result: list[DetectedEntity] = []
    skip: set[int] = set()
    for index, entity in enumerate(ordered):
        if index in skip:
            continue
        following = ordered[index + 1] if index + 1 < len(ordered) else None
        if (
            entity.category is EntityCategory.COMPANY
            and following is not None
            and following.category is EntityCategory.PERSON
            and _LAW_FIRM_PREFIX_RE.search(entity.text)
            and text[entity.end : following.start].strip() == ""
            and "\n" not in text[entity.end : following.start]
        ):
            entity = entity.model_copy(
                update={"end": following.end, "text": text[entity.start : following.end]}
            )
            skip.add(index + 1)
        result.append(entity)
    return result


def _filter_generic_court_companies(entities: list[DetectedEntity]) -> list[DetectedEntity]:
    # NER (and the "name before KRS number" regex) tag a bare "Sądu Okręgowego" or
    # "I Wydział Cywilny" as COMPANY; without a location it identifies nobody.
    return [
        entity
        for entity in entities
        if not (
            entity.category is EntityCategory.COMPANY
            and is_generic_court_reference(entity.text)
        )
    ]


def _address_entity_is_pkd_code_fragment(text: str, entity: DetectedEntity) -> bool:
    if not re.fullmatch(r"/\d{1,3}", entity.text):
        return False
    return bool(_PKD_CODE_SUFFIX_RE.match(text[entity.end : entity.end + 6]))


def _person_entity_has_place_context(text: str, entity: DetectedEntity) -> bool:
    if not is_place_name(entity.text):
        return False
    return has_address_context(text, entity.start, entity.end)


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
