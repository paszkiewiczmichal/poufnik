"""Deterministic Polish company recognizers and COMPANY confidence helpers."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Sequence

from anonymizer_engine.detection.models import (
    DetectedEntity,
    EntityCategory,
    ValidationStatus,
)

_LETTER = "A-ZĄĆĘŁŃÓŚŹŻ"
_WORD_CHARS = r"\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ&.-"
_CAPITAL_WORD = rf"[{_LETTER}][{_WORD_CHARS}]*"
_ACRONYM = rf"(?:[{_LETTER}]{{2,}}|P\.?P\.?H\.?U\.?|P\.?H\.?U\.?|ZPUE|CDM|PKP|PGE|PKN)"
_QUOTED_NAME = r"(?:\"[^\"]{1,80}\"|„[^”]{1,80}”)"
_NAME_PART = rf"(?:{_QUOTED_NAME}|{_ACRONYM}|{_CAPITAL_WORD})"
_JOINED_NAME_PART = rf"(?:i\s+Wspólnicy|i\s+Partnerzy|{_NAME_PART})"

LEGAL_FORM_PATTERN = (
    r"(?:"
    r"sp\.\s*z\s*o\.?\s*o\.?|spółka\s+z\s+ograniczoną\s+odpowiedzialnością|"
    r"s\.?\s*a\.?|spółka\s+akcyjna|"
    r"p\.?\s*s\.?\s*a\.?|prosta\s+spółka\s+akcyjna|"
    r"sp\.?\s*k\.?|spółka\s+komandytowa|"
    r"s\.?\s*k\.?\s*a\.?|spółka\s+komandytowo-akcyjna|"
    r"sp\.?\s*j\.?|spółka\s+jawna|"
    r"sp\.?\s*p\.?|spółka\s+partnerska"
    r")"
)
ORGANIZATION_FORM_PATTERN = (
    r"(?:"
    r"towarzystw(?:o|a|u|em|ie)|towarzystwem|"
    r"stowarzyszeni(?:e|a|u|em)|"
    r"fundacj(?:a|i|ą|ę)|"
    r"izb(?:a|y|ie|ą|ę)|"
    r"związk(?:u|iem|i|ów)|związek|"
    r"instytut(?:u|em|y|ów)?|"
    r"spółdzielni(?:a|e|ą)?|spółdzielnia"
    r")"
)
_LEGAL_FORM_RE = re.compile(rf"\b{LEGAL_FORM_PATTERN}\b", re.IGNORECASE)
_ORGANIZATION_FORM_RE = re.compile(rf"\b{ORGANIZATION_FORM_PATTERN}\b", re.IGNORECASE)
_COMPANY_WITH_LEGAL_FORM_RE = re.compile(
    rf"(?<![\w-]){_NAME_PART}(?:\s+{_JOINED_NAME_PART}){{0,7}}"
    rf"\s+(?i:{LEGAL_FORM_PATTERN})(?:\s+(?i:{LEGAL_FORM_PATTERN}))?",
)
_ORGANIZATION_WITH_FORM_RE = re.compile(
    rf"(?<![\w-])(?:{_NAME_PART}\s+){{0,3}}(?i:{ORGANIZATION_FORM_PATTERN})"
    rf"(?:\s+{_NAME_PART}){{1,6}}",
)
_COMPANY_NAME_BEFORE_ID_RE = re.compile(
    rf"(?:{_NAME_PART}\s+){{0,7}}{_NAME_PART}"
    rf"(?:\s+{_JOINED_NAME_PART}){{0,3}}"
    r"\s*(?:,|\(|$)",
)
_TRAILING_CONTEXT_RE = re.compile(
    r"^\s*(?:,|\(|-|–)?\s*(?:NIP|KRS|REGON|z\s+siedzibą|wpisan[ay]\s+do|"
    r"reprezentowan[ay]\s+przez|zwan[ay]\s+dalej)",
    re.IGNORECASE,
)

COMPANY_CONTEXT_LEMMAS = [
    "siedziba",
    "reprezentować",
    "reprezentowany",
    "zwany",
    "zwana",
    "dalej",
    "wpisany",
    "rejestr",
    "przedsiębiorca",
    "kapitał",
    "zakładowy",
]
_CONTEXT_RE = re.compile(
    r"(?:z\s+siedzibą\s+w|reprezentowan[ay]\s+przez|zwan[ay]\s+dalej|"
    r"wpisan[ay]\s+do\s+rejestru\s+przedsiębiorców|kapitał\s+zakładowy)",
    re.IGNORECASE,
)
_COMPANY_STOPWORDS = {
    "i",
    "oraz",
    "z",
    "w",
    "we",
    "do",
    "dla",
    "przez",
    "pod",
    "nad",
    "przeciwko",
    "powód",
    "pozwany",
    "pozwana",
    "pozew",
    "dostawca",
    "dostawcą",
    "partner",
    "partnerem",
    "wierzyciel",
    "wierzyciela",
    "kancelaria",
    "administrator",
    "administratorem",
    "pracodawca",
    "zapłacono",
    "nip",
    "krs",
    "regon",
    "reg0n",
    "umowa",
    "strona",
    "spółka",
    "spolka",
    "prezes",
    "zarząd",
    "zarządu",
    "skarbnik",
    "towarzystwo",
    "towarzystwem",
    "stowarzyszenie",
    "fundacja",
    "fundacji",
    "izba",
    "izby",
    "związek",
    "związku",
    "instytut",
    "instytutu",
    "spółdzielnia",
    "spółdzielni",
}
_ALIAS_DEFINITION_RE = re.compile(
    r"(?:zwan(?:y|a|ym|ą)\s+dalej|dalej\s+jako|dalej\s*:)\s*[\"„]([^\"”]{2,40})[\"”]",
    re.IGNORECASE,
)
_GENERIC_ALIASES = {
    "towarzystwo",
    "towarzystwem",
    "wykonawca",
    "wykonawcą",
    "zamawiający",
    "zamawiającym",
    "strona",
    "strony",
    "powód",
    "powódka",
    "pozwany",
    "pozwana",
}
_CONTEXTUAL_NAME_RE = re.compile(
    rf"\b(?:czasopism(?:a|o|em)|konferencj(?:a|i|ę|ą)|kongres(?:u|em)?|"
    rf"serwis(?:u|em)?|portal(?:u|em)?|magazyn(?:u|em)?|kwartalnik(?:a|iem)?)"
    rf"\s+(?P<name>{_QUOTED_NAME}|{_NAME_PART}(?:\s+{_NAME_PART}){{0,4}}(?:\s+\d{{4}})?)",
    re.IGNORECASE,
)


def detect_companies(
    text: str,
    deterministic_entities: Sequence[DetectedEntity] | None = None,
) -> list[DetectedEntity]:
    """Detect companies from legal forms and nearby Polish business identifiers."""
    entities: list[DetectedEntity] = []
    for match in _COMPANY_WITH_LEGAL_FORM_RE.finditer(text):
        start, end = _trim_company_span(text, match.start(), match.end())
        if end <= start:
            continue
        entities.append(_company_entity(text, start, end, confidence=0.95))

    for match in _ORGANIZATION_WITH_FORM_RE.finditer(text):
        start, end = _trim_company_span(text, match.start(), match.end())
        if end <= start:
            continue
        entities.append(_company_entity(text, start, end, confidence=0.86))

    for match in _CONTEXTUAL_NAME_RE.finditer(text):
        start, end = _trim_company_span(text, match.start("name"), match.end("name"))
        if end <= start:
            continue
        entities.append(_company_entity(text, start, end, confidence=0.7))

    for identifier in deterministic_entities or []:
        if identifier.category not in {
            EntityCategory.NIP,
            EntityCategory.KRS,
            EntityCategory.REGON,
        }:
            continue
        window_start = max(0, identifier.start - 60)
        window = text[window_start : identifier.start]
        for match in reversed(list(_COMPANY_NAME_BEFORE_ID_RE.finditer(window))):
            start = window_start + match.start()
            end = window_start + match.end()
            start, end = _trim_company_span(text, start, end)
            if end <= start:
                continue
            if _LEGAL_FORM_RE.search(text[start:end]):
                break
            if not company_root(text[start:end]):
                continue
            entities.append(_company_entity(text, start, end, confidence=0.8))
            break

    entities = _dedupe_companies(entities)
    entities.extend(_detect_aliases(text, entities))
    return _dedupe_companies(entities)


def downrank_unsupported_company_entities(
    text: str,
    ner_entities: Iterable[DetectedEntity],
    company_entities: Sequence[DetectedEntity],
    deterministic_entities: Sequence[DetectedEntity],
) -> list[DetectedEntity]:
    """Lower confidence for NER-only COMPANY candidates without legal/business support."""
    updated: list[DetectedEntity] = []
    for entity in ner_entities:
        if entity.category is not EntityCategory.COMPANY:
            updated.append(entity)
            continue
        if not company_root(text[entity.start : entity.end]):
            continue
        if company_has_support(text, entity, company_entities, deterministic_entities):
            updated.append(entity)
            continue
        updated.append(entity.model_copy(update={"confidence": min(entity.confidence, 0.5)}))
    return updated


def company_has_support(
    text: str,
    entity: DetectedEntity,
    company_entities: Sequence[DetectedEntity],
    deterministic_entities: Sequence[DetectedEntity],
) -> bool:
    value = text[entity.start : entity.end]
    if _LEGAL_FORM_RE.search(value):
        return True
    if any(_overlaps(entity, candidate) for candidate in company_entities):
        return True
    if company_context_near(text, entity.start, entity.end):
        return True
    return company_identifier_near(entity.start, entity.end, deterministic_entities)


def company_context_near(text: str, start: int, end: int, radius: int = 80) -> bool:
    before = text[max(0, start - radius) : start]
    after = text[end : min(len(text), end + radius)]
    return bool(_CONTEXT_RE.search(before) or _TRAILING_CONTEXT_RE.search(after))


def company_identifier_near(
    start: int,
    end: int,
    deterministic_entities: Sequence[DetectedEntity],
    radius: int = 80,
) -> bool:
    return any(
        entity.category in {EntityCategory.NIP, EntityCategory.KRS, EntityCategory.REGON}
        and entity.start <= end + radius
        and start <= entity.end + radius
        for entity in deterministic_entities
    )


def company_root(value: str) -> str:
    """Return a conservative root for grouping mentions with and without legal form."""
    normalized = _normalize(value)
    normalized = _LEGAL_FORM_RE.sub(" ", normalized)
    normalized = _ORGANIZATION_FORM_RE.sub(" ", normalized)
    normalized = re.sub(
        r"\b(?:spółka|spolka|akcyjna|komandytowa|jawna|partnerska)\b",
        " ",
        normalized,
    )
    normalized = re.sub(r"[^0-9a-ząćęłńóśźż]+", " ", normalized)
    parts = [part for part in normalized.split() if part and part not in _COMPANY_STOPWORDS]
    return " ".join(dict.fromkeys(parts))


def has_legal_form(value: str) -> bool:
    return bool(_LEGAL_FORM_RE.search(value))


def _company_entity(text: str, start: int, end: int, confidence: float) -> DetectedEntity:
    value = text[start:end]
    return DetectedEntity(
        category=EntityCategory.COMPANY,
        start=start,
        end=end,
        text=value,
        confidence=confidence,
        source="regex",
        validation=ValidationStatus.NOT_APPLICABLE,
        entity_group_id=f"company:{company_root(value)}",
        canonical_text=value.strip(),
    )


def _detect_aliases(text: str, company_entities: Sequence[DetectedEntity]) -> list[DetectedEntity]:
    aliases: list[DetectedEntity] = []
    for match in _ALIAS_DEFINITION_RE.finditer(text):
        alias = match.group(1).strip()
        if not alias or _normalize_alias(alias) in _GENERIC_ALIASES:
            continue
        owner = _nearest_company_before(company_entities, match.start())
        if owner is None or match.start() - owner.end > 140:
            continue
        aliases.extend(_alias_occurrences(text, alias, owner))
    return aliases


def _nearest_company_before(
    company_entities: Sequence[DetectedEntity],
    position: int,
) -> DetectedEntity | None:
    candidates = [entity for entity in company_entities if entity.end <= position]
    if not candidates:
        return None
    return max(candidates, key=lambda entity: entity.end)


def _alias_occurrences(
    text: str,
    alias: str,
    owner: DetectedEntity,
) -> list[DetectedEntity]:
    pattern = re.compile(rf"(?<![\w-]){re.escape(alias)}(?![\w-])")
    return [
        DetectedEntity(
            category=EntityCategory.COMPANY,
            start=match.start(),
            end=match.end(),
            text=text[match.start() : match.end()],
            confidence=0.78,
            source="regex",
            validation=ValidationStatus.NOT_APPLICABLE,
            entity_group_id=owner.entity_group_id,
            canonical_text=owner.canonical_text or owner.text,
        )
        for match in pattern.finditer(text)
    ]


def _normalize_alias(value: str) -> str:
    return _normalize(value).strip(" \t\r\n.,;:()[]{}\"'„”")


def _trim_company_span(text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and text[start].isspace():
        start += 1
    while start < end and text[end - 1] in " \t\r\n,;:()":
        end -= 1
    span = text[start:end]
    if _ORGANIZATION_FORM_RE.search(span) and not _LEGAL_FORM_RE.search(span):
        while start < end and text[end - 1] == ".":
            end -= 1
    span = text[start:end]
    legal_match = _LEGAL_FORM_RE.search(span)
    prefix_end = legal_match.start() if legal_match else len(span)
    boundaries = [match.end() for match in re.finditer(r"[.;:!?]\s+", span[:prefix_end])]
    if boundaries:
        start += boundaries[-1]
        while start < end and text[start].isspace():
            start += 1
    words = list(re.finditer(r"[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ&.-]+|\"[^\"]+\"|„[^”]+”", text[start:end]))
    while words:
        first = words[0].group().strip("\"„”").casefold().rstrip(".")
        if first not in _COMPANY_STOPWORDS:
            break
        start += words[0].end()
        while start < end and text[start].isspace():
            start += 1
        words.pop(0)
    if not company_root(text[start:end]):
        return end, end
    return start, end


def _normalize(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value).casefold()
    return normalized.replace("’", "'")


def _dedupe_companies(entities: list[DetectedEntity]) -> list[DetectedEntity]:
    selected: list[DetectedEntity] = []
    for entity in sorted(
        entities,
        key=lambda item: (-(item.end - item.start), -item.confidence, item.start),
    ):
        if any(_overlaps(entity, existing) for existing in selected):
            continue
        selected.append(entity)
    return sorted(selected, key=lambda item: (item.start, item.end))


def _overlaps(left: DetectedEntity, right: DetectedEntity) -> bool:
    return left.start < right.end and right.start < left.end
