import { describe, expect, it } from "vitest";

import { splitComparisonSegments } from "./comparisonSegments";
import type { OffsetMapEntry } from "../types";

describe("comparison segmenting", () => {
  it("segments original and anonymized text using offset_map entries", () => {
    const original = "Jan Kowalski ma PESEL 44051401359.";
    const anonymized = "[OSOBA_1] ma PESEL [PESEL_1].";
    const offsetMap: OffsetMapEntry[] = [
      {
        original_start: 0,
        original_end: 12,
        anonymized_start: 0,
        anonymized_end: 9,
        token: "[OSOBA_1]",
        category: "PERSON",
      },
      {
        original_start: 22,
        original_end: 33,
        anonymized_start: 19,
        anonymized_end: 28,
        token: "[PESEL_1]",
        category: "PESEL",
      },
    ];

    expect(splitComparisonSegments(original, offsetMap, "original")).toEqual([
      expect.objectContaining({ type: "replacement", text: "Jan Kowalski" }),
      expect.objectContaining({ type: "text", text: " ma PESEL " }),
      expect.objectContaining({ type: "replacement", text: "44051401359" }),
      expect.objectContaining({ type: "text", text: "." }),
    ]);
    expect(splitComparisonSegments(anonymized, offsetMap, "anonymized")).toEqual([
      expect.objectContaining({ type: "replacement", text: "[OSOBA_1]" }),
      expect.objectContaining({ type: "text", text: " ma PESEL " }),
      expect.objectContaining({ type: "replacement", text: "[PESEL_1]" }),
      expect.objectContaining({ type: "text", text: "." }),
    ]);
  });

  it("keeps adjacent replacements as adjacent segments", () => {
    const offsetMap: OffsetMapEntry[] = [
      {
        original_start: 0,
        original_end: 4,
        anonymized_start: 0,
        anonymized_end: 9,
        token: "[OSOBA_1]",
        category: "PERSON",
      },
      {
        original_start: 4,
        original_end: 15,
        anonymized_start: 9,
        anonymized_end: 18,
        token: "[PESEL_1]",
        category: "PESEL",
      },
    ];

    const originalSegments = splitComparisonSegments("Anna44051401359", offsetMap, "original");
    const anonymizedSegments = splitComparisonSegments(
      "[OSOBA_1][PESEL_1]",
      offsetMap,
      "anonymized",
    );

    expect(originalSegments.map((segment) => segment.text)).toEqual(["Anna", "44051401359"]);
    expect(anonymizedSegments.map((segment) => segment.text)).toEqual([
      "[OSOBA_1]",
      "[PESEL_1]",
    ]);
  });
});
