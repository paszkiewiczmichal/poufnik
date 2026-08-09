"""Token-based text anonymization and deanonymization."""

from __future__ import annotations

import hashlib
import re
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

from anonymizer_engine.anonymize.models import (
    AnonymizeResult,
    DeanonymizeResult,
    OffsetMapEntry,
    ReplacementEntry,
    ReplacementMap,
)
from anonymizer_engine.detection import DetectedEntity, EntityCategory

TOKEN_PREFIXES: dict[str, str] = {
    EntityCategory.PERSON.value: "OSOBA",
    EntityCategory.COMPANY.value: "FIRMA",
    EntityCategory.PUBLIC_INSTITUTION.value: "INSTYTUCJA",
    EntityCategory.ADDRESS.value: "ADRES",
    EntityCategory.PESEL.value: "PESEL",
    EntityCategory.NIP.value: "NIP",
    EntityCategory.REGON.value: "REGON",
    EntityCategory.ID_CARD.value: "DOWOD",
    EntityCategory.PASSPORT.value: "PASZPORT",
    EntityCategory.KRS.value: "KRS",
    EntityCategory.BANK_ACCOUNT.value: "RACHUNEK",
    EntityCategory.PAYMENT_CARD.value: "KARTA",
    EntityCategory.LAND_REGISTER.value: "KSIEGA_WIECZYSTA",
    EntityCategory.PHONE.value: "TELEFON",
    EntityCategory.EMAIL.value: "EMAIL",
    EntityCategory.URL.value: "URL",
    EntityCategory.IP_ADDRESS.value: "IP",
    EntityCategory.MAC_ADDRESS.value: "MAC",
    EntityCategory.API_KEY.value: "KLUCZ",
    EntityCategory.VEHICLE.value: "POJAZD",
    EntityCategory.CASE_NUMBER.value: "SYGNATURA",
    EntityCategory.ADMIN_CASE.value: "ZNAK_SPRAWY",
    EntityCategory.GPS.value: "GPS",
    EntityCategory.MONEY.value: "KWOTA",
    EntityCategory.DATE.value: "DATA",
    "CUSTOM": "DANE",
}

_TOKEN_RE = re.compile(r"\[[A-ZĄĆĘŁŃÓŚŹŻ]+(?:_[A-ZĄĆĘŁŃÓŚŹŻ]+)*_\d+\]")


@dataclass
class _EntityGroup:
    key: str
    token: str
    category: str
    canonical_text: str
    variants: list[str] = field(default_factory=list)


def anonymize(text: str, entities: list[DetectedEntity]) -> AnonymizeResult:
    """Replace accepted entity spans with stable bracketed tokens."""
    accepted_entities = _accepted_entities(text, entities)
    _validate_non_overlapping(accepted_entities)

    groups = _build_entity_groups(accepted_entities)
    parts: list[str] = []
    offset_map: list[OffsetMapEntry] = []
    cursor = 0
    anonymized_cursor = 0

    for entity in accepted_entities:
        group = groups[_entity_key(entity)]
        if entity.start > cursor:
            unchanged = text[cursor : entity.start]
            parts.append(unchanged)
            anonymized_cursor += len(unchanged)

        token_start = anonymized_cursor
        parts.append(group.token)
        anonymized_cursor += len(group.token)
        offset_map.append(
            OffsetMapEntry(
                original_start=entity.start,
                original_end=entity.end,
                anonymized_start=token_start,
                anonymized_end=anonymized_cursor,
                token=group.token,
                category=group.category,
            )
        )
        cursor = entity.end

    tail = text[cursor:]
    parts.append(tail)
    anonymized_text = "".join(parts)

    replacement_map = ReplacementMap(
        entries=[
            ReplacementEntry(
                token=group.token,
                category=group.category,
                canonical_text=group.canonical_text,
                variants=group.variants,
            )
            for group in groups.values()
        ],
        document_fingerprint=_fingerprint(text),
    )
    return AnonymizeResult(
        anonymized_text=anonymized_text,
        replacement_map=replacement_map,
        offset_map=offset_map,
    )


def deanonymize(text: str, replacement_map: ReplacementMap) -> DeanonymizeResult:
    """Replace exact ``[TOKEN_N]`` occurrences with canonical text from a map.

    Unknown bracketed tokens matching the Anonymizer token shape are left unchanged and
    reported in ``warnings``. Inflected original variants are restored as canonical text.
    """
    entries_by_token = replacement_map.entry_by_token()
    warnings: list[str] = []

    def replace(match: re.Match[str]) -> str:
        token = match.group(0)
        entry = entries_by_token.get(token)
        if entry is None:
            warnings.append(f"Unknown anonymization token {token} at offset {match.start()}.")
            return token
        return entry.canonical_text

    return DeanonymizeResult(text=_TOKEN_RE.sub(replace, text), warnings=warnings)


def _accepted_entities(text: str, entities: list[DetectedEntity]) -> list[DetectedEntity]:
    accepted: list[DetectedEntity] = []
    for entity in entities:
        if _status(entity) == "rejected":
            continue
        if entity.start < 0 or entity.end > len(text) or entity.end <= entity.start:
            msg = f"Invalid entity span: {entity.start}:{entity.end}"
            raise ValueError(msg)
        accepted.append(entity)
    return sorted(accepted, key=lambda item: (item.start, item.end))


def _validate_non_overlapping(entities: list[DetectedEntity]) -> None:
    previous: DetectedEntity | None = None
    for entity in entities:
        if previous is not None and entity.start < previous.end:
            msg = (
                "Overlapping entity spans cannot be anonymized safely: "
                f"{previous.start}:{previous.end} and {entity.start}:{entity.end}"
            )
            raise ValueError(msg)
        previous = entity


def _build_entity_groups(entities: list[DetectedEntity]) -> OrderedDict[str, _EntityGroup]:
    groups: OrderedDict[str, _EntityGroup] = OrderedDict()
    counters: dict[str, int] = {}

    for entity in entities:
        key = _entity_key(entity)
        variant = entity.text
        if key in groups:
            _append_unique(groups[key].variants, variant)
            continue

        category = _category_value(entity)
        prefix = TOKEN_PREFIXES.get(category, TOKEN_PREFIXES["CUSTOM"])
        counters[prefix] = counters.get(prefix, 0) + 1
        groups[key] = _EntityGroup(
            key=key,
            token=f"[{prefix}_{counters[prefix]}]",
            category=category,
            canonical_text=entity.canonical_text or entity.text,
            variants=[variant],
        )

    return groups


def _entity_key(entity: DetectedEntity) -> str:
    category = _category_value(entity)
    if entity.entity_group_id:
        return f"group:{category}:{entity.entity_group_id}"
    canonical = entity.canonical_text or entity.text
    return f"value:{category}:{canonical}"


def _category_value(entity: DetectedEntity) -> str:
    category = entity.category
    return getattr(category, "value", str(category))


def _status(entity: Any) -> str:
    return str(getattr(entity, "status", "accepted")).casefold()


def _append_unique(values: list[str], value: str) -> None:
    if value not in values:
        values.append(value)


def _fingerprint(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
