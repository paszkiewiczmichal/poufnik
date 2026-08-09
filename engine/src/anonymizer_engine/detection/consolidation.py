"""Entity grouping for repeated person and company mentions."""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from anonymizer_engine.detection.companies import company_root
from anonymizer_engine.detection.models import DetectedEntity, EntityCategory, EntityGroup

_WORD_RE = re.compile(r"[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ-]+", re.UNICODE)

_GROUPED_CATEGORIES = {EntityCategory.PERSON, EntityCategory.COMPANY}
_PERSON_PREFIXES = {"pan", "pani", "pana", "panią", "paniom", "państwo"}
_COMPANY_LEGAL_TERMS = {
    "s",
    "a",
    "sa",
    "sp",
    "z",
    "o",
    "oo",
    "spk",
    "spółka",
    "spolka",
    "akcyjny",
    "akcyjna",
    "komandytowy",
    "komandytowa",
    "ograniczony",
    "ograniczona",
    "odpowiedzialność",
    "odpowiedzialnoscia",
    "odpowiedzialnością",
}


@dataclass(frozen=True)
class _Mention:
    entity_index: int
    entity: DetectedEntity
    lemmas: tuple[str, ...]

    @property
    def lemma_set(self) -> frozenset[str]:
        return frozenset(self.lemmas)


def consolidate_entity_groups(
    entities: list[DetectedEntity],
    text: str,
    tokens: Iterable[Any] | None = None,
) -> tuple[list[DetectedEntity], list[EntityGroup]]:
    """Assign common group ids to PERSON and COMPANY mentions of the same entity."""
    mentions = [
        _Mention(index, entity, _span_lemmas(entity, text, tokens))
        for index, entity in enumerate(entities)
        if entity.category in _GROUPED_CATEGORIES
    ]
    mentions = [mention for mention in mentions if mention.lemmas]
    if not mentions:
        return entities, []

    grouped_mentions = _build_groups(mentions)
    updated_entities = list(entities)
    result_groups: list[EntityGroup] = []

    counters: dict[EntityCategory, int] = {}
    for group_mentions in grouped_mentions:
        category = group_mentions[0].entity.category
        counters[category] = counters.get(category, 0) + 1
        group_id = f"{category.value.lower()}-{counters[category]:03d}"
        canonical = _canonical_text(group_mentions)

        for mention in group_mentions:
            updated_entities[mention.entity_index] = mention.entity.model_copy(
                update={
                    "entity_group_id": group_id,
                    "canonical_text": canonical,
                }
            )

        result_groups.append(
            EntityGroup(
                entity_group_id=group_id,
                category=category,
                canonical_text=canonical,
                mentions=[(mention.entity.start, mention.entity.end) for mention in group_mentions],
            )
        )

    return updated_entities, result_groups


def _build_groups(mentions: list[_Mention]) -> list[list[_Mention]]:
    groups: list[list[_Mention]] = []
    multi_token = [mention for mention in mentions if len(mention.lemmas) > 1]
    single_token = [mention for mention in mentions if len(mention.lemmas) == 1]

    for mention in multi_token:
        matching_group = next(
            (
                group
                for group in groups
                if mention.entity.category == group[0].entity.category
                and any(_mentions_match(mention, existing) for existing in group)
            ),
            None,
        )
        if matching_group is None:
            groups.append([mention])
        else:
            matching_group.append(mention)

    for mention in single_token:
        candidates = [
            group
            for group in groups
            if mention.entity.category == group[0].entity.category
            and _single_token_mention_matches_group(mention, group)
        ]
        if len(candidates) == 1:
            candidates[0].append(mention)
        else:
            groups.append([mention])

    return [sorted(group, key=lambda mention: mention.entity.start) for group in groups]


def _mentions_match(left: _Mention, right: _Mention) -> bool:
    if _explicit_group_ids_match(left, right):
        return True
    if left.entity.category is EntityCategory.COMPANY and _company_roots_match(left, right):
        return True
    if left.lemma_set == right.lemma_set:
        return True
    if len(left.lemmas) == len(right.lemmas):
        return all(
            _within_conservative_edit_distance(a, b)
            for a, b in zip(left.lemmas, right.lemmas, strict=True)
        )
    shared = left.lemma_set & right.lemma_set
    return len(shared) >= 2 and shared == left.lemma_set or shared == right.lemma_set


def _single_token_mention_matches_group(mention: _Mention, group: list[_Mention]) -> bool:
    if any(_explicit_group_ids_match(mention, existing) for existing in group):
        return True
    lemma = mention.lemmas[0]
    if mention.entity.category is EntityCategory.COMPANY:
        mention_root = company_root(mention.entity.text)
        return any(
            lemma in existing.lemma_set
            or (mention_root and mention_root == company_root(existing.entity.text))
            for existing in group
        )
    return any(existing.lemmas and existing.lemmas[-1] == lemma for existing in group)


def _explicit_group_ids_match(left: _Mention, right: _Mention) -> bool:
    return (
        left.entity.category == right.entity.category
        and left.entity.entity_group_id is not None
        and left.entity.entity_group_id == right.entity.entity_group_id
    )


def _span_lemmas(
    entity: DetectedEntity,
    text: str,
    tokens: Iterable[Any] | None,
) -> tuple[str, ...]:
    token_lemmas: list[str] = []
    if tokens is not None:
        for token in tokens:
            token_text = str(getattr(token, "text", ""))
            token_start = getattr(token, "idx", None)
            if token_start is None:
                continue
            token_end = int(token_start) + len(token_text)
            if int(token_start) < entity.end and entity.start < token_end:
                token_lemmas.append(str(getattr(token, "lemma_", "") or token_text))

    if not token_lemmas:
        token_lemmas = [
            match.group()
            for match in _WORD_RE.finditer(text[entity.start : entity.end])
        ]

    normalized = [_normalize_lemma(lemma) for lemma in token_lemmas]
    normalized = [lemma for lemma in normalized if lemma]
    if entity.category is EntityCategory.PERSON:
        normalized = [lemma for lemma in normalized if lemma not in _PERSON_PREFIXES]
    if entity.category is EntityCategory.COMPANY:
        normalized = [lemma for lemma in normalized if lemma not in _COMPANY_LEGAL_TERMS]
    return tuple(dict.fromkeys(normalized))


def _company_roots_match(left: _Mention, right: _Mention) -> bool:
    left_root = company_root(left.entity.text)
    right_root = company_root(right.entity.text)
    if not left_root or not right_root:
        return False
    return left_root == right_root


def _canonical_text(group: list[_Mention]) -> str:
    category = group[0].entity.category
    best = max(group, key=lambda mention: (len(mention.lemmas), -(mention.entity.start)))
    if category is EntityCategory.PERSON:
        return " ".join(_title_name_part(lemma) for lemma in best.lemmas)
    return best.entity.text.strip()


def _normalize_lemma(value: str) -> str:
    normalized = value.strip(" \t\r\n.,;:()[]{}\"'").lower()
    normalized = normalized.replace(".", "")
    return normalized


def _title_name_part(value: str) -> str:
    return "-".join(part[:1].upper() + part[1:] for part in value.split("-") if part)


def _within_conservative_edit_distance(left: str, right: str) -> bool:
    shortest = min(len(left), len(right))
    threshold = 3 if shortest >= 8 else 2 if shortest >= 7 else 1
    return _levenshtein(left, right) <= threshold


def _levenshtein(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)

    previous = list(range(len(right) + 1))
    for left_index, left_char in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_char in enumerate(right, start=1):
            insert_cost = current[right_index - 1] + 1
            delete_cost = previous[right_index] + 1
            replace_cost = previous[right_index - 1] + (left_char != right_char)
            current.append(min(insert_cost, delete_cost, replace_cost))
        previous = current
    return previous[-1]
