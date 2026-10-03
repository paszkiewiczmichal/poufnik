import { describe, expect, it } from "vitest";

import type { ReplacementMap } from "../types";
import { poufnikFileName } from "./batchExport";
import { anonymizeFileBaseName } from "./fileNameAnonymization";

const map: ReplacementMap = {
  document_fingerprint: "x",
  created_at: "2026-10-03T00:00:00Z",
  entries: [
    {
      token: "[OSOBA_1]",
      category: "PERSON",
      canonical_text: "Jan Kowalski",
      variants: ["Janem Kowalskim", "Jan Kowalski"],
    },
    {
      token: "[FIRMA_1]",
      category: "COMPANY",
      canonical_text: "Kancelaria Przykład sp. z o.o.",
      variants: ["Kancelaria Przykład sp. z o.o."],
    },
    { token: "[PESEL_1]", category: "PESEL", canonical_text: "44051401359", variants: ["44051401359"] },
  ],
};

describe("anonymizeFileBaseName", () => {
  it("replaces a surname in another grammatical form than in the document", () => {
    expect(anonymizeFileBaseName("Umowa Kowalski", map)).toBe("Umowa [OSOBA_1]");
    expect(anonymizeFileBaseName("Pozew przeciwko Kowalskiemu", map)).toBe(
      "Pozew przeciwko [OSOBA_1]",
    );
  });

  it("treats underscores, dots and dashes as word separators", () => {
    expect(anonymizeFileBaseName("pelnomocnictwo_Jan_Kowalski_2026", map)).toBe(
      "pelnomocnictwo_[OSOBA_1]_2026",
    );
    expect(anonymizeFileBaseName("wniosek-44051401359", map)).toBe("wniosek-[PESEL_1]");
  });

  it("replaces the whole name once instead of each word separately", () => {
    expect(anonymizeFileBaseName("Jan Kowalski - umowa", map)).toBe("[OSOBA_1] - umowa");
  });

  it("does not touch words that only contain a value or other names", () => {
    expect(anonymizeFileBaseName("Janowski umowa", map)).toBe("Janowski umowa");
    expect(anonymizeFileBaseName("Kowalczyk umowa", map)).toBe("Kowalczyk umowa");
    expect(anonymizeFileBaseName("Kancelaria - regulamin", map)).toBe("Kancelaria - regulamin");
  });

  it("leaves the name as it is without a replacement map", () => {
    expect(anonymizeFileBaseName("Umowa Kowalski", null)).toBe("Umowa Kowalski");
  });
});

describe("poufnikFileName with a replacement map", () => {
  it("builds the result and map names from the anonymized base name", () => {
    expect(poufnikFileName("Umowa Kowalski.docx", "docx", "result", map)).toBe(
      "Umowa [OSOBA_1]_poufnik.docx",
    );
    expect(poufnikFileName("Umowa Kowalski.docx", "json", "map", map)).toBe(
      "Umowa [OSOBA_1]_poufnik_mapa.json",
    );
  });
});
