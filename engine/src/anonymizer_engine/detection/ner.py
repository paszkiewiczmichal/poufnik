"""NER integration through Microsoft Presidio and spaCy."""

from __future__ import annotations

import importlib.util
import inspect
import re
import sys
from pathlib import Path
from typing import Any, Protocol

from anonymizer_engine.detection.companies import COMPANY_CONTEXT_LEMMAS
from anonymizer_engine.detection.models import (
    DetectedEntity,
    EntityCategory,
    ValidationStatus,
)

_SPACY_TO_PRESIDIO = {
    "persName": "PERSON",
    "orgName": "ORGANIZATION",
    "placeName": "LOCATION",
    "geogName": "LOCATION",
    "date": "DATE_TIME",
}
_IGNORED_SPACY_LABELS = ["O", "time"]
_PRESIDIO_TO_CATEGORY = {
    "PERSON": EntityCategory.PERSON,
    "ORGANIZATION": EntityCategory.COMPANY,
    "LOCATION": EntityCategory.ADDRESS,
    "DATE_TIME": EntityCategory.DATE,
}
_PRESIDIO_ENTITIES = sorted(_PRESIDIO_TO_CATEGORY)
DEFAULT_SPACY_MODEL = "pl_core_news_lg"

_STREET_ADDRESS_RE = re.compile(
    r"\b(?:ul\.|ulicy|al\.|alei|pl\.|placu)\s+"
    r"[A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]*"
    r"(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]*){0,2}"
    r"\s+\d+[A-Za-z]?(?:/\d+)?",
)
_POLISH_DATE_RE = re.compile(
    r"\b\d{1,2}\s+"
    r"(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|"
    r"września|października|listopada|grudnia)\s+\d{4}\s*r\.?",
    re.IGNORECASE,
)
_COMPANY_WITH_LEGAL_FORM_RE = re.compile(
    r"\b[A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ&.-]*"
    r"(?:\s+(?:i\s+Wspólnicy|[A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ&.-]*)){0,4}"
    r"\s+(?:sp\.\s*z\s*o\.o\.|sp\.k\.|S\.A\.)",
)


class NerEngine(Protocol):
    def analyze(self, text: str, language: str) -> list[DetectedEntity]:
        """Return NER entities for text in the requested language."""


class SpacyPresidioEngine:
    """Polish spaCy NER model orchestrated by Presidio AnalyzerEngine."""

    def __init__(
        self,
        model_name: str = DEFAULT_SPACY_MODEL,
        supported_language: str = "pl",
    ) -> None:
        from presidio_analyzer import AnalyzerEngine
        from presidio_analyzer.nlp_engine import NlpEngineProvider

        self.supported_language = supported_language
        self.last_tokens: Any | None = None
        resolved_model_name = resolve_spacy_model(model_name)

        configuration = {
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": supported_language, "model_name": resolved_model_name}],
            "ner_model_configuration": {
                "labels_to_ignore": _IGNORED_SPACY_LABELS,
                "model_to_presidio_entity_mapping": _SPACY_TO_PRESIDIO,
                "low_confidence_score_multiplier": 0.4,
                "low_score_entity_names": [],
            },
        }
        provider = NlpEngineProvider(nlp_configuration=configuration)
        self._nlp_engine = provider.create_engine()
        self._analyzer = AnalyzerEngine(
            nlp_engine=self._nlp_engine,
            supported_languages=[supported_language],
        )
        self._install_company_context(supported_language)
        self.model_labels = self._read_model_labels(supported_language)

    def analyze(self, text: str, language: str) -> list[DetectedEntity]:
        if language != self.supported_language:
            msg = f"Unsupported language {language!r}; expected {self.supported_language!r}"
            raise ValueError(msg)

        artifacts = self._nlp_engine.process_text(text, language)
        self.last_tokens = getattr(artifacts, "tokens", None)

        analyze_kwargs: dict[str, Any] = {
            "text": text,
            "language": language,
            "entities": _PRESIDIO_ENTITIES,
            "score_threshold": 0.0,
        }
        if "nlp_artifacts" in inspect.signature(self._analyzer.analyze).parameters:
            analyze_kwargs["nlp_artifacts"] = artifacts

        presidio_results = self._analyzer.analyze(**analyze_kwargs)
        entities = [
            self._to_detected_entity(result, text)
            for result in presidio_results
            if result.entity_type in _PRESIDIO_TO_CATEGORY
        ]
        entities.extend(_detect_company_legal_forms(text))
        entities.extend(_detect_street_addresses(text))
        entities.extend(_detect_polish_dates(text))
        return _dedupe_ner_overlaps(entities)

    def _to_detected_entity(self, result: Any, text: str) -> DetectedEntity:
        category = _PRESIDIO_TO_CATEGORY[result.entity_type]
        return DetectedEntity(
            category=category,
            start=result.start,
            end=result.end,
            text=text[result.start : result.end],
            confidence=float(result.score),
            source="ner",
            validation=ValidationStatus.NOT_APPLICABLE,
        )

    def _install_company_context(self, language: str) -> None:
        recognizers = self._analyzer.registry.get_recognizers(
            language=language,
            entities=["ORGANIZATION"],
        )
        for recognizer in recognizers:
            context = list(getattr(recognizer, "context", []) or [])
            recognizer.context = list(dict.fromkeys([*context, *COMPANY_CONTEXT_LEMMAS]))

    def _read_model_labels(self, language: str) -> tuple[str, ...]:
        nlp_by_language = getattr(self._nlp_engine, "nlp", {})
        nlp = nlp_by_language.get(language) if isinstance(nlp_by_language, dict) else None
        if nlp is None or "ner" not in nlp.pipe_names:
            return ()
        return tuple(sorted(nlp.get_pipe("ner").labels))


def resolve_spacy_model(model_name: str = DEFAULT_SPACY_MODEL) -> str:
    if _module_available(model_name):
        return model_name
    if packaged_model_path := find_packaged_spacy_model_path(model_name):
        return str(packaged_model_path)
    return model_name


def spacy_model_available(model_name: str = DEFAULT_SPACY_MODEL) -> bool:
    return _module_available(model_name) or find_packaged_spacy_model_path(model_name) is not None


def _module_available(module_name: str) -> bool:
    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, ValueError):
        return False


def find_packaged_spacy_model_path(model_name: str) -> Path | None:
    for base_dir in _packaged_model_base_dirs():
        package_dir = base_dir / model_name
        if (package_dir / "config.cfg").exists():
            return package_dir
        for candidate in sorted(package_dir.glob(f"{model_name}-*"), reverse=True):
            if (candidate / "config.cfg").exists():
                return candidate
    return None


def _packaged_model_base_dirs() -> list[Path]:
    candidates: list[Path] = []
    if meipass := getattr(sys, "_MEIPASS", None):
        candidates.append(Path(meipass))
    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).resolve().parent / "_internal")

    unique: list[Path] = []
    for candidate in candidates:
        if candidate not in unique:
            unique.append(candidate)
    return unique


def _detect_street_addresses(text: str) -> list[DetectedEntity]:
    return [
        DetectedEntity(
            category=EntityCategory.ADDRESS,
            start=match.start(),
            end=match.end(),
            text=match.group(),
            confidence=0.78,
            source="ner",
            validation=ValidationStatus.NOT_APPLICABLE,
        )
        for match in _STREET_ADDRESS_RE.finditer(text)
    ]


def _detect_company_legal_forms(text: str) -> list[DetectedEntity]:
    return [
        DetectedEntity(
            category=EntityCategory.COMPANY,
            start=match.start(),
            end=match.end(),
            text=match.group(),
            confidence=0.92,
            source="ner",
            validation=ValidationStatus.NOT_APPLICABLE,
        )
        for match in _COMPANY_WITH_LEGAL_FORM_RE.finditer(text)
    ]


def _detect_polish_dates(text: str) -> list[DetectedEntity]:
    return [
        DetectedEntity(
            category=EntityCategory.DATE,
            start=match.start(),
            end=match.end(),
            text=match.group(),
            confidence=0.85,
            source="ner",
            validation=ValidationStatus.NOT_APPLICABLE,
        )
        for match in _POLISH_DATE_RE.finditer(text)
    ]


def _dedupe_ner_overlaps(entities: list[DetectedEntity]) -> list[DetectedEntity]:
    selected: list[DetectedEntity] = []
    for entity in sorted(
        entities,
        key=lambda item: (
            -(item.end - item.start),
            -item.confidence,
            item.start,
            item.category.value,
        ),
    ):
        if any(_overlaps(entity, existing) for existing in selected):
            continue
        selected.append(entity)
    return sorted(selected, key=lambda item: (item.start, item.end, item.category.value))


def _overlaps(left: DetectedEntity, right: DetectedEntity) -> bool:
    return left.start < right.end and right.start < left.end
