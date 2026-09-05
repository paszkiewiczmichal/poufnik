"""Dictionary-backed Polish first-name and surname recognizer."""

from __future__ import annotations

import re
import sqlite3
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files
from pathlib import Path
from typing import Any

from anonymizer_engine.detection.models import (
    DetectedEntity,
    EntityCategory,
    ValidationStatus,
)
from anonymizer_engine.detection.places import is_place_name

_WORD_RE = re.compile(r"[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ-]+", re.UNICODE)
_TITLE_BEFORE_RE = re.compile(
    r"(?:^|[\s,(])(?:(?:Pan|Pani|Panią|Mecenas|mec\.?|adw\.?|r\.pr\.?|radca\s+prawny|"
    r"prof\.?|dr\.?|hab\.?|n\.?|med\.?|lek\.?|mgr\.?|inż\.?)\s+){1,6}$",
    re.IGNORECASE,
)
_TITLE_WORDS = {
    "adw",
    "dr",
    "hab",
    "inż",
    "lek",
    "mec",
    "mecenas",
    "med",
    "mgr",
    "n",
    "pan",
    "pani",
    "panią",
    "prof",
    "pr",
    "r",
    "radca",
    "prawny",
}
_COMMON_FUNCTION_WORDS = {
    "do",
    "z",
    "w",
    "u",
    "o",
    "a",
    "i",
    "na",
    "od",
    "za",
    "po",
    "dla",
    "we",
    "ze",
}
_NEGATIVE_PERSON_WORDS = {
    *_TITLE_WORDS,
    *_COMMON_FUNCTION_WORDS,
    "powód",
    "powoda",
    "powodem",
    "powódka",
    "powódkę",
    "powódki",
    "pozwany",
    "pozwanego",
    "pozwana",
    "pozwaną",
    "wykonawca",
    "wykonawcę",
    "zamawiający",
    "zamawiającego",
    "strona",
    "strony",
    "prezes",
    "zarząd",
    "zarządu",
    "skarbnik",
}
_POLISH_GERMAN_ADJECTIVES = {
    "polski",
    "polska",
    "polskie",
    "polskiego",
    "polskiej",
    "polskim",
    "niemiecki",
    "niemiecka",
    "niemieckie",
    "niemieckiego",
    "niemieckiej",
    "niemieckim",
}
_LOCATION_PREPOSITIONS = {"w", "we"}
_PLACE_CONTEXT_BEFORE_RE = re.compile(
    r"(?:^|[\s,(;:-])(?:w|we|miasta|miejscowości)\s+$"
    r"|(?:^|[\s,(;:-])dla\s+miasta(?:\s+[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ-]+)?\s+$",
    re.IGNORECASE,
)
_STREET_PREFIX_BEFORE_RE = re.compile(
    r"(?:^|[\s,(])(?:ul\.?|ulicy|al\.?|alei|pl\.?|placu|przy)\s+$",
    re.IGNORECASE,
)
_COMPANY_AFTER_RE = re.compile(
    r"^\s+(?:i\s+wspólnicy\b|(?:[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+\s+){0,4}"
    r"(?:sp\.\s*z\s*o\.o\.|sp\.k\.|s\.a\.))",
    re.IGNORECASE,
)
_INITIAL_RE = re.compile(r"^[A-ZĄĆĘŁŃÓŚŹŻ]\.$")
_INITIAL_LETTER_RE = re.compile(r"^[A-ZĄĆĘŁŃÓŚŹŻ]$")
_SENTENCE_ENDING = ".!?"

_SURNAME_SUFFIX_REPLACEMENTS = (
    ("skiego", "ski"),
    ("ckiego", "cki"),
    ("kiego", "ki"),
    ("iego", "i"),
    ("ego", "i"),
    ("skiemu", "ski"),
    ("ckiemu", "cki"),
    ("kiemu", "ki"),
    ("iemu", "i"),
    ("emu", "i"),
    ("skiej", "ski"),
    ("ckiej", "cki"),
    ("kiej", "ki"),
    ("iej", "a"),
    ("ej", "a"),
    ("ską", "ski"),
    ("cką", "cki"),
    ("ką", "ki"),
    ("ową", ""),
    ("ą", "a"),
    ("owi", ""),
    ("owie", ""),
    ("ach", ""),
    ("ów", ""),
    ("em", ""),
    ("im", "i"),
    ("ym", "y"),
)


@dataclass(frozen=True)
class _NameDb:
    first_names: frozenset[str]
    surnames: frozenset[str]
    homographs: frozenset[str]


@dataclass(frozen=True)
class _Token:
    text: str
    idx: int
    lemma: str
    is_sent_start: bool

    @property
    def end(self) -> int:
        return self.idx + len(self.text)


@dataclass(frozen=True)
class _TokenMatch:
    token: _Token
    first_name: str | None
    surname: str | None


def detect_dictionary(
    text: str,
    spacy_doc: Iterable[Any] | None,
    ner_entities: Sequence[DetectedEntity] | None = None,
) -> list[DetectedEntity]:
    """Detect PERSON spans from the packaged Polish names database."""
    name_db = _name_db()
    tokens = [_match_token(token, name_db) for token in _iter_tokens(text, spacy_doc)]
    entities: list[DetectedEntity] = []
    used_token_indexes: set[int] = set()

    for index, left in enumerate(tokens[:-1]):
        right = tokens[index + 1]
        if not _is_adjacent(text, left.token, right.token):
            continue
        if left.first_name and right.surname:
            entities.append(_entity(text, left.token.idx, right.token.end, 0.95))
            used_token_indexes.update({index, index + 1})
        elif left.surname and right.first_name:
            entities.append(_entity(text, left.token.idx, right.token.end, 0.95))
            used_token_indexes.update({index, index + 1})

    for index, match in enumerate(tokens):
        if index in used_token_indexes:
            continue
        token = match.token
        if match.surname and (
            not match.first_name or _has_person_context(text, tokens, index)
        ):
            if _looks_like_address_context(text, tokens, index) or _looks_like_company_context(
                text,
                token,
            ):
                continue
            is_homograph = match.surname in name_db.homographs or token.is_sent_start
            has_context = _has_person_context(text, tokens, index)
            has_ner_confirmation = _has_ner_confirmation(ner_entities, token)
            if is_homograph and not (has_context or has_ner_confirmation):
                continue
            entities.append(_entity(text, token.idx, token.end, 0.6))
            continue
        if match.first_name:
            if token.is_sent_start and not _has_person_context(text, tokens, index):
                continue
            entities.append(_entity(text, token.idx, token.end, 0.5))

    return _dedupe_dictionary_overlaps(entities)


def _match_token(token: _Token, name_db: _NameDb) -> _TokenMatch:
    normalized = _normalize_lookup(token.text)
    if is_negative_person_text(token.text) or normalized in _POLISH_GERMAN_ADJECTIVES:
        return _TokenMatch(token=token, first_name=None, surname=None)
    if not _is_capitalized(token.text) or len(normalized) <= 1:
        return _TokenMatch(token=token, first_name=None, surname=None)
    first_name = _lookup_first_name(token, name_db)
    surname = _lookup_surname(token, name_db)
    return _TokenMatch(token=token, first_name=first_name, surname=surname)


def _lookup_first_name(token: _Token, name_db: _NameDb) -> str | None:
    if _normalize_lookup(token.text) in _TITLE_WORDS:
        return None
    for candidate in _lookup_candidates(token):
        if candidate in name_db.first_names:
            return candidate
    return None


def _lookup_surname(token: _Token, name_db: _NameDb) -> str | None:
    if _normalize_lookup(token.text) in _TITLE_WORDS:
        return None
    for candidate in [*_lookup_candidates(token), *_surname_fallback_candidates(token.text)]:
        if candidate in name_db.surnames:
            return candidate
    return None


def is_negative_person_text(value: str) -> bool:
    """Return True for titles and party roles that must not be PERSON."""
    normalized_words = [_normalize_lookup(match.group()) for match in _WORD_RE.finditer(value)]
    normalized_words = [word for word in normalized_words if word]
    if not normalized_words:
        return False
    if len(normalized_words) == 1:
        word = normalized_words[0]
        return word in _NEGATIVE_PERSON_WORDS or word in _POLISH_GERMAN_ADJECTIVES
    return all(word in _TITLE_WORDS for word in normalized_words)


def _lookup_candidates(token: _Token) -> list[str]:
    candidates = [_normalize_lookup(token.lemma), _normalize_lookup(token.text)]
    return [candidate for candidate in dict.fromkeys(candidates) if candidate]


def _surname_fallback_candidates(value: str) -> list[str]:
    normalized = _normalize_lookup(value)
    candidates: list[str] = []
    for suffix, replacement in _SURNAME_SUFFIX_REPLACEMENTS:
        if not normalized.endswith(suffix) or len(normalized) <= len(suffix) + 1:
            continue
        candidates.append(normalized[: -len(suffix)] + replacement)
        if suffix in {"em", "im"}:
            candidates.append(normalized[: -len(suffix)])
    return [candidate for candidate in dict.fromkeys(candidates) if len(candidate) >= 2]


def _has_person_context(text: str, tokens: list[_TokenMatch], index: int) -> bool:
    token = tokens[index].token
    if _TITLE_BEFORE_RE.search(text[max(0, token.idx - 20) : token.idx]):
        return True
    previous_match = tokens[index - 1] if index > 0 else None
    next_match = tokens[index + 1] if index + 1 < len(tokens) else None
    if previous_match and previous_match.first_name and _is_adjacent(
        text,
        previous_match.token,
        token,
    ):
        return True
    if next_match and next_match.first_name and _is_adjacent(text, token, next_match.token):
        return True
    if previous_match and _is_initial(previous_match.token):
        return True
    if index >= 2 and _is_split_initial(tokens[index - 2].token, previous_match.token):
        return True
    return False


def _looks_like_address_context(text: str, tokens: list[_TokenMatch], index: int) -> bool:
    token = tokens[index].token
    before = text[max(0, token.idx - 20) : token.idx]
    after = text[token.end : token.end + 12]
    previous = tokens[index - 1].token if index > 0 else None
    if _STREET_PREFIX_BEFORE_RE.search(before):
        return True
    if re.match(r"^\s+\d", after):
        return True
    if previous and _normalize_lookup(previous.text) in _LOCATION_PREPOSITIONS:
        return True
    if is_place_name(token.text) and _PLACE_CONTEXT_BEFORE_RE.search(
        text[max(0, token.idx - 45) : token.idx]
    ):
        return True
    return False


def _looks_like_company_context(text: str, token: _Token) -> bool:
    return bool(_COMPANY_AFTER_RE.match(text[token.end : token.end + 50]))


def _has_ner_confirmation(
    ner_entities: Sequence[DetectedEntity] | None,
    token: _Token,
) -> bool:
    return any(
        entity.category is EntityCategory.PERSON
        and entity.start == token.idx
        and entity.end == token.end
        for entity in ner_entities or []
    )


def _is_initial(token: _Token) -> bool:
    return bool(_INITIAL_RE.fullmatch(token.text))


def _is_split_initial(left: _Token, right: _Token | None) -> bool:
    return right is not None and _INITIAL_LETTER_RE.fullmatch(left.text) and right.text == "."


def _entity(text: str, start: int, end: int, confidence: float) -> DetectedEntity:
    return DetectedEntity(
        category=EntityCategory.PERSON,
        start=start,
        end=end,
        text=text[start:end],
        confidence=confidence,
        source="dictionary",
        validation=ValidationStatus.NOT_APPLICABLE,
    )


def _iter_tokens(text: str, spacy_doc: Iterable[Any] | None) -> list[_Token]:
    tokens = [_adapt_spacy_token(token) for token in spacy_doc or []]
    tokens = [
        token
        for token in tokens
        if token is not None and (_contains_letter(token.text) or token.text == ".")
    ]
    if tokens:
        return tokens
    return [
        _Token(
            text=match.group(),
            idx=match.start(),
            lemma=match.group(),
            is_sent_start=_is_sentence_start(text, match.start()),
        )
        for match in _WORD_RE.finditer(text)
        if _fallback_token_is_relevant(match.group())
    ]


def _fallback_token_is_relevant(value: str) -> bool:
    normalized = _normalize_lookup(value)
    return _is_capitalized(value) or normalized in _TITLE_WORDS or _INITIAL_RE.fullmatch(value)


def _adapt_spacy_token(token: Any) -> _Token | None:
    token_text = str(getattr(token, "text", ""))
    token_start = getattr(token, "idx", None)
    if token_start is None or not token_text:
        return None
    return _Token(
        text=token_text,
        idx=int(token_start),
        lemma=str(getattr(token, "lemma_", "") or token_text),
        is_sent_start=bool(getattr(token, "is_sent_start", False)),
    )


def _is_sentence_start(text: str, start: int) -> bool:
    index = start - 1
    while index >= 0 and text[index].isspace():
        index -= 1
    return index < 0 or text[index] in _SENTENCE_ENDING


def _is_adjacent(text: str, left: _Token, right: _Token) -> bool:
    return left.end <= right.idx and text[left.end : right.idx].strip() == ""


def _contains_letter(value: str) -> bool:
    return any(char.isalpha() for char in value)


def _is_capitalized(value: str) -> bool:
    first = next((char for char in value if char.isalpha()), "")
    return bool(first and first.isupper())


def _normalize_lookup(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    normalized = normalized.strip(" \t\r\n.,;:()[]{}\"'")
    normalized = normalized.replace("’", "'")
    return normalized.casefold()


def _dedupe_dictionary_overlaps(entities: list[DetectedEntity]) -> list[DetectedEntity]:
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


@lru_cache(maxsize=1)
def _name_db() -> _NameDb:
    db_path = _default_db_path()
    if not db_path.exists():
        msg = f"Names database not found: {db_path}"
        raise RuntimeError(msg)

    try:
        with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as connection:
            first_names = frozenset(
                row[0].casefold() for row in connection.execute("SELECT name FROM first_names")
            )
            surnames = frozenset(
                row[0].casefold() for row in connection.execute("SELECT name FROM surnames")
            )
            homographs = frozenset(
                row[0].casefold() for row in connection.execute("SELECT name FROM homographs")
            )
    except sqlite3.DatabaseError as exc:
        msg = f"Names database cannot be read: {db_path}. Reinstall Poufnik or restore names.db."
        raise RuntimeError(msg) from exc
    return _NameDb(first_names=first_names, surnames=surnames, homographs=homographs)


def _default_db_path() -> Path:
    return Path(str(files("anonymizer_engine.detection").joinpath("resources", "names.db")))
