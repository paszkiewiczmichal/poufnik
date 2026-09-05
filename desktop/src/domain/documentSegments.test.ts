import { describe, expect, it } from "vitest";

import { blocksForExport, segmentBlock, splitTextIntoBlocks } from "./documentSegments";
import type { DetectedEntity } from "../types";

describe("document segmenting", () => {
  it("applies non-overlapping entity spans inside one block", () => {
    const text = "Jan ma PESEL 44051401359.";
    const [block] = splitTextIntoBlocks(text);
    const entities: DetectedEntity[] = [
      entity("PERSON", 0, 3, "Jan"),
      entity("PESEL", 13, 24, "44051401359"),
    ];

    const segments = segmentBlock(block, entities, visible(["PERSON", "PESEL"]));

    expect(segments.map((segment) => segment.text)).toEqual([
      "Jan",
      " ma PESEL ",
      "44051401359",
      ".",
    ]);
    expect(segments.filter((segment) => segment.type === "entity")).toHaveLength(2);
  });

  it("keeps Polish diacritics aligned with spans", () => {
    const text = "Zażółć gęślą jaźń";
    const [block] = splitTextIntoBlocks(text);
    const entities = [entity("CUSTOM", 7, 12, "gęślą")];

    const segments = segmentBlock(block, entities, visible(["CUSTOM"]));

    expect(segments[1]).toMatchObject({ type: "entity", text: "gęślą" });
  });

  it("handles an entity starting on a block boundary", () => {
    const text = "Ala\n\nJan";
    const blocks = splitTextIntoBlocks(text);
    const entities = [entity("PERSON", 5, 8, "Jan")];

    const secondBlockSegments = segmentBlock(blocks[1], entities, visible(["PERSON"]));

    expect(secondBlockSegments).toEqual([
      expect.objectContaining({ type: "entity", start: 5, end: 8, text: "Jan" }),
    ]);
  });

  it("clips an entity crossing a block boundary", () => {
    const text = "Zażółć\n\ngęślą";
    const blocks = splitTextIntoBlocks(text);
    const entities = [entity("CUSTOM", 0, text.length, text)];

    const first = segmentBlock(blocks[0], entities, visible(["CUSTOM"]));
    const second = segmentBlock(blocks[1], entities, visible(["CUSTOM"]));

    expect(first).toEqual([
      expect.objectContaining({ type: "entity", text: "Zażółć\n\n" }),
    ]);
    expect(second).toEqual([expect.objectContaining({ type: "entity", text: "gęślą" })]);
  });

  it("increments the page number across form-feed separators", () => {
    const blocks = splitTextIntoBlocks("Strona 1\fStrona 2\fStrona 3");

    expect(blocks.map((block) => block.page)).toEqual([1, 2, 3]);
  });

  it("returns no blocks for empty text", () => {
    expect(splitTextIntoBlocks("")).toEqual([]);
  });

  it("splits an oversized paragraph into multiple chunked blocks", () => {
    const longText = "a".repeat(12_000);

    const blocks = splitTextIntoBlocks(longText);

    expect(blocks.length).toBe(3);
    expect(blocks[0].end - blocks[0].start).toBe(5000);
    expect(blocks[2].end - blocks[2].start).toBe(2000);
    expect(blocks.map((block) => block.text).join("")).toBe(longText);
  });

  it("hides entities whose category is not in the visible set", () => {
    const text = "Jan ma PESEL 44051401359.";
    const [block] = splitTextIntoBlocks(text);
    const entities: DetectedEntity[] = [entity("PERSON", 0, 3, "Jan")];

    const segments = segmentBlock(block, entities, visible(["PESEL"]));

    expect(segments).toEqual([expect.objectContaining({ type: "text", text })]);
  });
});

describe("blocksForExport", () => {
  it("maps document blocks to paragraph export blocks with page numbers", () => {
    const blocks = blocksForExport("Strona 1\fStrona 2");

    expect(blocks).toEqual([
      { start: 0, end: 9, kind: "paragraph", page: 1 },
      { start: 9, end: 17, kind: "paragraph", page: 2 },
    ]);
  });
});

function entity(
  category: DetectedEntity["category"],
  start: number,
  end: number,
  text: string,
): DetectedEntity {
  return {
    id: `${category}-${start}-${end}`,
    category,
    start,
    end,
    text,
    confidence: 1,
    source: "regex",
    validation: "passed",
    status: "accepted",
    entity_group_id: `${category}:${text}`,
    canonical_text: text,
  };
}

function visible(categories: DetectedEntity["category"][]): Set<DetectedEntity["category"]> {
  return new Set(categories);
}
