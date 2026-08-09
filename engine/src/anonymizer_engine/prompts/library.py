"""YAML-backed prompt library loading and rendering."""

from __future__ import annotations

import logging
from importlib import resources
from pathlib import Path

import yaml
from pydantic import BaseModel, Field, ValidationError, field_validator

LOGGER = logging.getLogger(__name__)
DOCUMENT_PLACEHOLDER = "{{DOKUMENT}}"


class PromptTemplate(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    category: str = Field(min_length=1)
    description: str = Field(min_length=1)
    body: str = Field(min_length=1)
    tags: list[str]
    version: str = Field(min_length=1)

    @field_validator("body")
    @classmethod
    def body_must_contain_document_placeholder(cls, value: str) -> str:
        if DOCUMENT_PLACEHOLDER not in value:
            msg = f"body must contain {DOCUMENT_PLACEHOLDER}"
            raise ValueError(msg)
        return value

    @field_validator("tags")
    @classmethod
    def tags_must_be_strings(cls, value: list[str]) -> list[str]:
        if any(not tag.strip() for tag in value):
            msg = "tags must contain non-empty strings"
            raise ValueError(msg)
        return value


class PromptLibrary:
    def __init__(self, templates: list[PromptTemplate]) -> None:
        self._templates: dict[str, PromptTemplate] = {}
        for template in templates:
            self._templates[template.id] = template

    @property
    def templates(self) -> list[PromptTemplate]:
        return sorted(
            self._templates.values(),
            key=lambda item: (item.category, item.title, item.id),
        )

    @property
    def categories(self) -> list[str]:
        return sorted({template.category for template in self._templates.values()})

    def get(self, prompt_id: str) -> PromptTemplate | None:
        return self._templates.get(prompt_id)


def load_prompt_library(user_path: str | Path | None = None) -> PromptLibrary:
    templates: list[PromptTemplate] = []
    templates.extend(_load_builtin_templates())
    if user_path:
        templates.extend(_load_directory(Path(user_path)))
    return PromptLibrary(templates)


def render_prompt(template: PromptTemplate | str, anonymized_text: str) -> str:
    body = template.body if isinstance(template, PromptTemplate) else template
    return body.replace(DOCUMENT_PLACEHOLDER, anonymized_text)


def _load_builtin_templates() -> list[PromptTemplate]:
    root = resources.files("anonymizer_engine.prompts.resources").joinpath("prompts-library")
    with resources.as_file(root) as path:
        return _load_directory(path)


def _load_directory(path: Path) -> list[PromptTemplate]:
    if not path.exists():
        LOGGER.warning("Prompt library directory does not exist: %s", path)
        return []
    if not path.is_dir():
        LOGGER.warning("Prompt library path is not a directory: %s", path)
        return []

    templates: list[PromptTemplate] = []
    for file_path in sorted([*path.rglob("*.yaml"), *path.rglob("*.yml")]):
        template = _load_file(file_path)
        if template is not None:
            templates.append(template)
    return templates


def _load_file(path: Path) -> PromptTemplate | None:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except OSError as exc:
        LOGGER.warning("Could not read prompt file %s: %s", path, exc)
        return None
    except yaml.YAMLError as exc:
        LOGGER.warning("Invalid YAML in prompt file %s: %s", path, exc)
        return None

    if not isinstance(raw, dict):
        LOGGER.warning("Prompt file %s must contain a YAML mapping.", path)
        return None

    try:
        return PromptTemplate.model_validate(raw)
    except ValidationError as exc:
        LOGGER.warning("Invalid prompt schema in %s: %s", path, _format_validation_error(exc))
        return None


def _format_validation_error(exc: ValidationError) -> str:
    messages: list[str] = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error["loc"])
        messages.append(f"{location}: {error['msg']}")
    return "; ".join(messages)
