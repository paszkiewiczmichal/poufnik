import { describe, expect, it } from "vitest";

import { batchExportFiles, poufnikFileName } from "./batchExport";
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
      { filename: "umowa_poufnik.txt", contents: "Treść [OSOBA_1]" },
      {
        filename: "umowa_poufnik_mapa.json",
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
      "umowa__poufnik.txt",
      "umowa__poufnik_mapa.json",
      "umowa_-2_poufnik.txt",
      "umowa_-2_poufnik_mapa.json",
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

describe("poufnikFileName", () => {
  it("keeps the original name and adds the _poufnik suffix in place of the extension", () => {
    expect(poufnikFileName("umowa.docx", "docx")).toBe("umowa_poufnik.docx");
    expect(poufnikFileName("umowa najmu.pdf", "pdf")).toBe("umowa najmu_poufnik.pdf");
    expect(poufnikFileName("umowa v1.2.docx", "docx")).toBe("umowa v1.2_poufnik.docx");
  });

  it("names the replacement map next to the result", () => {
    expect(poufnikFileName("umowa.docx", "json", "map")).toBe("umowa_poufnik_mapa.json");
  });

  it("sanitizes characters that are invalid in Windows file names", () => {
    expect(poufnikFileName('umowa: "A"/B?.pdf', "docx")).toBe("umowa_ _A__B__poufnik.docx");
  });

  it("falls back to a generic name when the source name is missing", () => {
    expect(poufnikFileName(null, "docx")).toBe("dokument_poufnik.docx");
    expect(poufnikFileName(undefined, "pdf")).toBe("dokument_poufnik.pdf");
    expect(poufnikFileName("", "json", "map")).toBe("dokument_poufnik_mapa.json");
  });
});
