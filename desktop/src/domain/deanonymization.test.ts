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

  it("keeps a token as plain text when it has no matching map entry", () => {
    const map: ReplacementMap = { entries: [], document_fingerprint: "test" };

    const segments = restoredSegmentsFromTokenizedText("[OSOBA_1] zlozyl pozew.", "[OSOBA_1] zlozyl pozew.", map);

    expect(segments).toEqual([
      { type: "text", text: "[OSOBA_1]", start: 0, end: 9 },
      { type: "text", text: " zlozyl pozew.", start: 9, end: 23 },
    ]);
  });

  it("restores leading text, multiple tokens, and trailing text in one pass", () => {
    const map: ReplacementMap = {
      entries: [
        { token: "[OSOBA_1]", category: "PERSON", canonical_text: "Jan Kowalski", variants: [] },
        { token: "[OSOBA_2]", category: "PERSON", canonical_text: "Anna Nowak", variants: [] },
      ],
      document_fingerprint: "test",
    };

    const segments = restoredSegmentsFromTokenizedText(
      "Strony: [OSOBA_1] oraz [OSOBA_2], koniec.",
      "Strony: Jan Kowalski oraz Anna Nowak, koniec.",
      map,
    );

    expect(segments.map((segment) => segment.text)).toEqual([
      "Strony: ",
      "Jan Kowalski",
      " oraz ",
      "Anna Nowak",
      ", koniec.",
    ]);
    expect(segments.map((segment) => segment.type)).toEqual([
      "text",
      "restored",
      "text",
      "restored",
      "text",
    ]);
  });

  it("returns a single text segment when the tokenized text has no tokens at all", () => {
    const map: ReplacementMap = { entries: [], document_fingerprint: "test" };

    const segments = restoredSegmentsFromTokenizedText("Zwykly tekst bez tokenow.", "Zwykly tekst bez tokenow.", map);

    expect(segments).toEqual([
      { type: "text", text: "Zwykly tekst bez tokenow.", start: 0, end: 25 },
    ]);
  });
});
