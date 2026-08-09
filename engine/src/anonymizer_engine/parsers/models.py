"""Models for parsed document text and layout blocks."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

BlockKind = Literal["paragraph", "heading", "table_cell", "page_break"]
DocumentFormat = Literal["txt", "docx", "pdf", "png", "jpg", "heic"]
DocumentSource = Literal["parsed", "ocr"]


class Block(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    kind: BlockKind
    page: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_span(self) -> Block:
        if self.end < self.start:
            msg = "end must be greater than or equal to start"
            raise ValueError(msg)
        return self


class ParsedDocument(BaseModel):
    text: str
    blocks: list[Block]
    format: DocumentFormat
    has_text_layer: bool
    page_count: int = Field(ge=0)
    source: DocumentSource = "parsed"

    @model_validator(mode="after")
    def validate_blocks(self) -> ParsedDocument:
        text_length = len(self.text)
        for block in self.blocks:
            if block.end > text_length:
                msg = "block span exceeds text length"
                raise ValueError(msg)
            if block.page is not None and block.page > self.page_count:
                msg = "block page exceeds page_count"
                raise ValueError(msg)
        return self
