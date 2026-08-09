"""Plan model and built-in defaults."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Plan(BaseModel):
    code: str = Field(min_length=1)
    monthly_document_limit: int | None = Field(default=None, ge=0)
    monthly_request_limit: int | None = Field(default=None, ge=0)
    max_instances: int | None = Field(default=None, ge=0)
    features: list[str] = Field(default_factory=list)


BASIC_PLAN = Plan(
    code="basic",
    monthly_document_limit=None,
    monthly_request_limit=None,
    max_instances=None,
    features=[],
)

EARLY_BIRD_PLAN = Plan(
    code="early_bird",
    monthly_document_limit=None,
    monthly_request_limit=None,
    max_instances=None,
    features=[],
)

PRO_PLAN = Plan(
    code="pro",
    monthly_document_limit=None,
    monthly_request_limit=None,
    max_instances=None,
    features=[],
)

ENTERPRISE_PLAN = Plan(
    code="enterprise",
    monthly_document_limit=None,
    monthly_request_limit=None,
    max_instances=None,
    features=[],
)

BUILT_IN_PLANS = {
    plan.code: plan for plan in (BASIC_PLAN, EARLY_BIRD_PLAN, PRO_PLAN, ENTERPRISE_PLAN)
}


def normalize_plan_code(code: str) -> str:
    """Map persisted legacy plan codes to the current contract."""
    if code == "free":
        return BASIC_PLAN.code
    return code
