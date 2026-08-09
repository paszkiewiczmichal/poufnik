"""Models for anonymization replacement maps."""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel, Field


class ReplacementEntry(BaseModel):
    token: str
    category: str
    canonical_text: str
    variants: list[str] = Field(default_factory=list)


class ReplacementMap(BaseModel):
    entries: list[ReplacementEntry]
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    document_fingerprint: str

    def to_json(self) -> str:
        return self.model_dump_json()

    @classmethod
    def from_json(cls, value: str) -> ReplacementMap:
        return cls.model_validate_json(value)

    def entry_by_token(self) -> dict[str, ReplacementEntry]:
        return {entry.token: entry for entry in self.entries}


class OffsetMapEntry(BaseModel):
    original_start: int = Field(ge=0)
    original_end: int = Field(ge=0)
    anonymized_start: int = Field(ge=0)
    anonymized_end: int = Field(ge=0)
    token: str
    category: str


class AnonymizeResult(BaseModel):
    anonymized_text: str
    replacement_map: ReplacementMap
    offset_map: list[OffsetMapEntry] = Field(default_factory=list)


class DeanonymizeResult(str):
    """Result of reverse substitution.

    Round-trip restores each token to ``canonical_text`` from the map. If an original
    occurrence was inflected, deanonymization intentionally returns the canonical form,
    not the exact grammatical variant.
    """

    warnings: list[str]

    def __new__(cls, text: str, warnings: list[str] | None = None) -> DeanonymizeResult:
        value = str.__new__(cls, text)
        value.warnings = list(warnings or [])
        return value

    @property
    def text(self) -> str:
        return str(self)
