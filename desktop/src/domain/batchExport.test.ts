import { describe, expect, it } from "vitest";

import { batchExportFiles } from "./batchExport";
import type { ReplacementMap } from "../types";

describe("batch export", () => {
  it("creates result and map files per document", () => {
    const files = batchExportFiles([
      {
        filename: "umowa.docx",
        anonymizedText: "Treść [OSOBA_1]",
        replacementMap: replacementMap(),
      },
    ]);

    expect(files).toEqual([
      { filename: "umowa.anon.txt", contents: "Treść [OSOBA_1]" },
      {
        filename: "umowa.map.json",
        contents: JSON.stringify(replacementMap(), null, 2),
      },
    ]);
  });

  it("deduplicates and sanitizes export file names", () => {
    const files = batchExportFiles([
      { filename: "umowa?.docx", anonymizedText: "A", replacementMap: replacementMap() },
      { filename: "umowa*.pdf", anonymizedText: "B", replacementMap: replacementMap() },
    ]);

    expect(files.map((file) => file.filename)).toEqual([
      "umowa_.anon.txt",
      "umowa_.map.json",
      "umowa_-2.anon.txt",
      "umowa_-2.map.json",
    ]);
  });
});

function replacementMap(): ReplacementMap {
  return {
    entries: [
      {
        token: "[OSOBA_1]",
        category: "PERSON",
        canonical_text: "Jan Kowalski",
        variants: ["Jan Kowalski"],
      },
    ],
    document_fingerprint: "abc",
  };
}
