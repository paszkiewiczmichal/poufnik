"""Request and response models for API v1."""

from __future__ import annotations

from typing import Any, Literal

import regex as regex_module
from pydantic import BaseModel, Field, field_validator

from anonymizer_engine.anonymize import OffsetMapEntry, ReplacementMap
from anonymizer_engine.detection import DetectedEntity
from anonymizer_engine.detection.deterministic import regex_has_catastrophic_backtracking_risk
from anonymizer_engine.parsers.models import Block, DocumentFormat, DocumentSource


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    models_loaded: bool


class InfoResponse(BaseModel):
    version: str
    languages: list[str]
    categories: list[str]
    plan: dict[str, Any]
    license_status: str
    update_available: bool = False
    latest_version: str | None = None
    degraded_reason: str | None = None


class ProblemResponse(BaseModel):
    type: str = "about:blank"
    title: str
    status: int
    detail: str
    instance: str | None = None
    errors: Any | None = None


MAX_CUSTOM_RULES = 25
MAX_CUSTOM_RULE_PATTERN_LENGTH = 256


class AnalyzeRequest(BaseModel):
    text: str
    language: str = "pl"
    custom_rules: list[dict[str, Any]] | None = Field(
        default=None,
        max_length=MAX_CUSTOM_RULES,
        description=(
            "Optional local custom regex rules. At most 25 rules are accepted; "
            "each pattern/regex value is limited to 256 characters and must compile. "
            "Matches are returned as CUSTOM entities with source=regex."
        ),
    )

    @field_validator("custom_rules")
    @classmethod
    def validate_custom_rules(
        cls,
        value: list[dict[str, Any]] | None,
    ) -> list[dict[str, Any]] | None:
        if value is None:
            return value
        if len(value) > MAX_CUSTOM_RULES:
            raise ValueError(f"custom_rules cannot contain more than {MAX_CUSTOM_RULES} rules")
        for index, rule in enumerate(value):
            pattern = rule.get("pattern", rule.get("regex"))
            if pattern is not None and not isinstance(pattern, str):
                raise ValueError(f"custom_rules[{index}] pattern must be a string")
            if not pattern:
                raise ValueError(f"custom_rules[{index}] pattern is required")
            if isinstance(pattern, str) and len(pattern) > MAX_CUSTOM_RULE_PATTERN_LENGTH:
                raise ValueError(
                    f"custom_rules[{index}] pattern exceeds "
                    f"{MAX_CUSTOM_RULE_PATTERN_LENGTH} characters"
                )
            try:
                regex_module.compile(pattern)
            except regex_module.error as exc:
                raise ValueError(f"custom_rules[{index}] pattern is invalid: {exc}") from exc
            if regex_has_catastrophic_backtracking_risk(pattern):
                raise ValueError(
                    f"custom_rules[{index}] pattern has nested quantifiers and is not allowed"
                )
        return value


class AnalyzeResponse(BaseModel):
    entities: list[DetectedEntity]


class AnonymizeRequest(BaseModel):
    text: str
    language: str = "pl"
    entities: list[DetectedEntity] | None = None


class AnonymizeResponse(BaseModel):
    anonymized_text: str
    replacement_map: ReplacementMap
    offset_map: list[OffsetMapEntry] = Field(default_factory=list)


class DeanonymizeRequest(BaseModel):
    text: str
    replacement_map: ReplacementMap


class DeanonymizeResponse(BaseModel):
    original_text: str
    warnings: list[str] = Field(default_factory=list)


class ExportRequest(BaseModel):
    anonymized_text: str
    format: Literal["docx", "pdf"]
    blocks: list[Block] | None = None


class ProcessedDocument(BaseModel):
    filename: str
    format: DocumentFormat
    source: DocumentSource
    page_count: int = Field(ge=0)
    text: str


class DocumentProcessResponse(BaseModel):
    document: ProcessedDocument
    entities: list[DetectedEntity]
    anonymized_text: str
    replacement_map: ReplacementMap
    offset_map: list[OffsetMapEntry] = Field(default_factory=list)


class PromptTemplateResponse(BaseModel):
    id: str
    title: str
    category: str
    description: str
    body: str
    tags: list[str]
    version: str


class UsageResponse(BaseModel):
    period: str
    requests: int = Field(ge=0)
    documents: int = Field(ge=0)
