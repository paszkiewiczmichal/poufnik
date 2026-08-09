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
