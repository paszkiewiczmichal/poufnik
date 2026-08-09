"""Detection primitives."""

from anonymizer_engine.detection.companies import detect_companies
from anonymizer_engine.detection.deterministic import (
    detect_deterministic,
    validate_bank_account,
    validate_id_card,
    validate_land_register,
    validate_nip,
    validate_passport,
    validate_payment_card,
    validate_pesel,
    validate_regon,
)
from anonymizer_engine.detection.dictionary import detect_dictionary
from anonymizer_engine.detection.models import (
    DetectedEntity,
    DetectionResult,
    EntityCategory,
    EntityGroup,
    EntityStatus,
    ValidationStatus,
)
from anonymizer_engine.detection.ner import NerEngine, SpacyPresidioEngine
from anonymizer_engine.detection.pipeline import detect_all
from anonymizer_engine.detection.public_institutions import detect_public_institutions

__all__ = [
    "DetectedEntity",
    "DetectionResult",
    "EntityCategory",
    "EntityGroup",
    "EntityStatus",
    "NerEngine",
    "SpacyPresidioEngine",
    "ValidationStatus",
    "detect_all",
    "detect_companies",
    "detect_deterministic",
    "detect_dictionary",
    "detect_public_institutions",
    "validate_bank_account",
    "validate_id_card",
    "validate_land_register",
    "validate_nip",
    "validate_passport",
    "validate_payment_card",
    "validate_pesel",
    "validate_regon",
]
