"""Shared detection models."""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class EntityCategory(StrEnum):
    PESEL = "PESEL"
    NIP = "NIP"
    REGON = "REGON"
    ID_CARD = "ID_CARD"
    PASSPORT = "PASSPORT"
    KRS = "KRS"
    BANK_ACCOUNT = "BANK_ACCOUNT"
    PAYMENT_CARD = "PAYMENT_CARD"
    LAND_REGISTER = "LAND_REGISTER"
    PHONE = "PHONE"
    EMAIL = "EMAIL"
    URL = "URL"
    IP_ADDRESS = "IP_ADDRESS"
    MAC_ADDRESS = "MAC_ADDRESS"
    API_KEY = "API_KEY"
    VEHICLE = "VEHICLE"
    CASE_NUMBER = "CASE_NUMBER"
    ADMIN_CASE = "ADMIN_CASE"
    GPS = "GPS"
    MONEY = "MONEY"
    PERSON = "PERSON"
    COMPANY = "COMPANY"
    PUBLIC_INSTITUTION = "PUBLIC_INSTITUTION"
    ADDRESS = "ADDRESS"
    DATE = "DATE"
    CUSTOM = "CUSTOM"


class ValidationStatus(StrEnum):
    PASSED = "passed"
    FAILED = "failed"
    NOT_APPLICABLE = "not_applicable"


class EntityStatus(StrEnum):
    ACCEPTED = "accepted"
    REJECTED = "rejected"


EntitySource = Literal["regex", "dictionary", "ner", "manual"]


class DetectedEntity(BaseModel):
    category: EntityCategory
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    text: str
    confidence: float = Field(ge=0.0, le=1.0)
    source: EntitySource = "regex"
    corroborated_by: list[str] = Field(default_factory=list)
    validation: ValidationStatus
    entity_group_id: str | None = None
    canonical_text: str | None = None
    status: EntityStatus = EntityStatus.ACCEPTED

    @model_validator(mode="after")
    def validate_span(self) -> "DetectedEntity":
        if self.end <= self.start:
            msg = "end must be greater than start"
            raise ValueError(msg)
        return self


class EntityGroup(BaseModel):
    entity_group_id: str
    category: EntityCategory
    canonical_text: str
    mentions: list[tuple[int, int]]


class DetectionResult(BaseModel):
    text: str
    entities: list[DetectedEntity]
    entity_groups: list[EntityGroup] = Field(default_factory=list)
