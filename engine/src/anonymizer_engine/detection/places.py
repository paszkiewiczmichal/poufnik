"""Packaged Polish locality dictionary from TERYT/SIMC."""

from __future__ import annotations

import re
import sqlite3
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files
from pathlib import Path

from anonymizer_engine.detection.models import (
    DetectedEntity,
    EntityCategory,
    ValidationStatus,
)

_WORD_RE = re.compile(r"[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ-]+", re.UNICODE)
_ADDRESS_CONTEXT_BEFORE_RE = re.compile(
    r"(?:^|[\s,(;:-])(?:w|we|do|dla|miasta|m\.|miejscowości|siedzibą|adres)\s+$"
    r"|(?:^|[\s,(;:-])dla\s+miasta(?:\s+[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ-]+)?\s+$",
    re.IGNORECASE,
)
_POSTAL_CODE_BEFORE_RE = re.compile(r"\b\d{2}-\d{3}\s*[\),;:-]?\s*$")

_MANUAL_PLACE_FORMS = {
    "gdańsk": {"gdańsku", "gdańska", "gdańskiem"},
    "gdynia": {"gdyni"},
    "kraków": {"krakowie", "krakowa", "krakowem"},
    "lublin": {"lublinie", "lublina", "lublinem"},
    "łódź": {"łodzią", "łodzi"},
    "poznań": {"poznaniu", "poznania", "poznaniem"},
    "sopot": {"sopocie", "sopotu", "sopotem"},
    "szczecin": {"szczecinie", "szczecina", "szczecinem"},
    "warszawa": {"warszawy", "warszawie", "warszawą"},
    "wrocław": {"wrocławiu", "wrocławia", "wrocławiem"},
}


@dataclass(frozen=True)
class _PlaceDb:
    forms: frozenset[str]


def detect_places(text: str) -> list[DetectedEntity]:
    """Detect locality names only when address context is visible nearby."""
    entities: list[DetectedEntity] = []
    for match in _WORD_RE.finditer(text):
        value = match.group()
        if not _is_capitalized(value) or not is_place_name(value):
            continue
        if not _has_address_context(text, match.start(), match.end()):
            continue
        entities.append(
            DetectedEntity(
                category=EntityCategory.ADDRESS,
                start=match.start(),
                end=match.end(),
                text=value,
                confidence=0.76,
                source="dictionary",
                validation=ValidationStatus.NOT_APPLICABLE,
            )
        )
    return _dedupe_places(entities)


def is_place_name(value: str) -> bool:
    """Return True when a token matches a SIMC locality or a common inflected form."""
    normalized = _normalize(value)
    if not normalized or len(normalized) <= 1:
        return False
    if normalized in _manual_forms():
        return True
    place_db = _place_db()
    return normalized in place_db.forms


def _has_address_context(text: str, start: int, end: int) -> bool:
    before = text[max(0, start - 35) : start]
    after = text[end : min(len(text), end + 20)]
    return bool(
        _ADDRESS_CONTEXT_BEFORE_RE.search(before)
        or _POSTAL_CODE_BEFORE_RE.search(before)
        or re.match(r"^\s*[,()]*\s*\d{2}-\d{3}\b", after)
    )


def _is_capitalized(value: str) -> bool:
    first = next((char for char in value if char.isalpha()), "")
    return bool(first and first.isupper())


def _normalize(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    normalized = normalized.strip(" \t\r\n.,;:()[]{}\"'„”")
    return normalized.casefold()


@lru_cache(maxsize=1)
def _manual_forms() -> frozenset[str]:
    forms: set[str] = set()
    for base, variants in _MANUAL_PLACE_FORMS.items():
        forms.add(base)
        forms.update(variants)
    return frozenset(forms)


@lru_cache(maxsize=1)
def _place_db() -> _PlaceDb:
    db_path = _default_db_path()
    if not db_path.exists():
        return _PlaceDb(forms=frozenset())

    try:
        with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as connection:
            forms = frozenset(
                row[0].casefold() for row in connection.execute("SELECT form FROM locality_forms")
            )
    except sqlite3.DatabaseError as exc:
        msg = (
            f"Locality database cannot be read: {db_path}. "
            "Reinstall Poufnik or restore places.db."
        )
        raise RuntimeError(msg) from exc
    return _PlaceDb(forms=forms)


def _default_db_path() -> Path:
    return Path(str(files("anonymizer_engine.detection").joinpath("resources", "places.db")))


def _dedupe_places(entities: list[DetectedEntity]) -> list[DetectedEntity]:
    selected: list[DetectedEntity] = []
    for entity in sorted(entities, key=lambda item: (-(item.end - item.start), item.start)):
        if any(_overlaps(entity, existing) for existing in selected):
            continue
        selected.append(entity)
    return sorted(selected, key=lambda item: (item.start, item.end))


def _overlaps(left: DetectedEntity, right: DetectedEntity) -> bool:
    return left.start < right.end and right.start < left.end
