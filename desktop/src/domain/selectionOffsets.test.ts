import { describe, expect, it } from "vitest";

import { selectionPointsToDocumentRange } from "./selectionOffsets";

describe("selection offset mapping", () => {
  it("maps selection points from paginated blocks to absolute document offsets", () => {
    const range = selectionPointsToDocumentRange(
      { blockStart: 250_000, offsetInBlock: 17 },
      { blockStart: 255_000, offsetInBlock: 9 },
    );

    expect(range).toEqual({ start: 250_017, end: 255_009 });
  });

  it("normalizes backward selections", () => {
    const range = selectionPointsToDocumentRange(
      { blockStart: 1000, offsetInBlock: 30 },
      { blockStart: 1000, offsetInBlock: 12 },
    );

    expect(range).toEqual({ start: 1012, end: 1030 });
  });
});
