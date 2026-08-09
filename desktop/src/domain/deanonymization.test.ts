import { describe, expect, it } from "vitest";

import { restoredSegmentsFromTokenizedText } from "./deanonymization";
import type { ReplacementMap } from "../types";

describe("restoredSegmentsFromTokenizedText", () => {
  it("recognizes token prefixes containing underscores", () => {
    const map: ReplacementMap = {
      entries: [
        {
          token: "[KSIEGA_WIECZYSTA_1]",
          category: "LAND_REGISTER",
          canonical_text: "GD1G/00012345/0",
          variants: [],
        },
      ],
      created_at: "2026-07-14T00:00:00Z",
      document_fingerprint: "test",
    };

    const segments = restoredSegmentsFromTokenizedText(
      "KW [KSIEGA_WIECZYSTA_1]",
      "KW GD1G/00012345/0",
      map,
    );

    expect(segments).toContainEqual({
      type: "restored",
      text: "GD1G/00012345/0",
      start: 3,
      end: 18,
      token: "[KSIEGA_WIECZYSTA_1]",
    });
  });
});
