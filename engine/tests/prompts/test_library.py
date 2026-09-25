from __future__ import annotations

import logging
from pathlib import Path

import pytest

from anonymizer_engine.prompts import load_prompt_library, render_prompt


def test_loads_builtin_prompts_and_renders_document() -> None:
    library = load_prompt_library()
    template = library.get("contract-risk-review")

    assert template is not None
    assert template.category == "analiza_umowy"
    assert "TREŚĆ" in render_prompt(template, "TREŚĆ")


def test_invalid_prompt_files_are_logged_and_skipped(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    invalid_path = tmp_path / "bad.yaml"
    invalid_path.write_text(
        """
id: bad
title: Bad
category: test
description: Missing placeholder
body: Brak placeholdera
tags: [test]
version: "1"
""".strip(),
        encoding="utf-8",
    )

    caplog.set_level(logging.WARNING, logger="anonymizer_engine.prompts.library")
    library = load_prompt_library(tmp_path)

    assert library.get("bad") is None
    assert "Invalid prompt schema" in caplog.text


BUILTIN_RULE_MARKERS = (
    "[OSOBA_1]",  # znaczniki anonimizacji zostają bez zmian
    "materiałem do analizy",  # treść dokumentu nie jest źródłem poleceń
    "dosłowny",  # cytaty tylko z dokumentu
    "[DO WERYFIKACJI]",  # przepisy do sprawdzenia
    "[SYGNATURA DO WERYFIKACJI]",  # brak sygnatur z pamięci
    "wymaga weryfikacji przez prawnika",
)


def test_builtin_library_has_prompts_for_each_area() -> None:
    library = load_prompt_library()

    assert len(library.templates) >= 12
    assert {"analiza_umowy", "pisma_procesowe", "rodo", "praca_ogolna"} <= set(library.categories)


def test_every_builtin_prompt_carries_the_shared_working_rules() -> None:
    for template in load_prompt_library().templates:
        for marker in BUILTIN_RULE_MARKERS:
            assert marker in template.body, f"{template.id} lacks rule marker {marker!r}"


def test_every_builtin_prompt_puts_the_document_in_one_delimited_place() -> None:
    for template in load_prompt_library().templates:
        assert template.body.count("{{DOKUMENT}}") == 1, template.id
        assert "=== DOKUMENT (zanonimizowany) ===" in template.body, template.id
        assert template.body.rstrip().endswith("=== KONIEC DOKUMENTU ==="), template.id


def test_builtin_prompts_use_polish_diacritics() -> None:
    # Regresja: pierwsza wersja biblioteki była zapisana bez polskich znaków.
    for template in load_prompt_library().templates:
        assert any(char in template.body for char in "ąćęłńóśźż"), template.id
        assert "ponizszy" not in template.body, template.id
