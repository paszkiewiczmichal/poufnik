import { describe, expect, it } from "vitest";

import { segmentBlock, splitTextIntoBlocks } from "./documentSegments";
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
