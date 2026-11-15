import { describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import { legacyExtension, prepareDocument } from "./legacyFormats";

describe("prepareDocument", () => {
  it("converts DOC and RTF to DOCX and leaves other files alone", async () => {
    const convert = vi.fn(async (file: File) => new File(["PK"], file.name.replace(/\.\w+$/, ".docx")));

    const doc = await prepareDocument(new File(["x"], "Umowa.DOC"), convert);
    const pdf = await prepareDocument(new File(["x"], "umowa.pdf"), convert);

    expect(doc).toEqual({ file: expect.objectContaining({ name: "Umowa.docx" }), converted: true });
    expect(convert).toHaveBeenCalledWith(expect.any(File), "doc");
    expect(pdf.converted).toBe(false);
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it("explains that Word or LibreOffice is needed when neither is installed", async () => {
    const convert = vi.fn(async () => {
      throw "no_renderer";
    });

    await expect(prepareDocument(new File(["x"], "pismo.rtf"), convert)).rejects.toThrow(
      texts.errors.legacyNeedsOffice("RTF"),
    );
  });

  it("recognizes only the old Word formats", () => {
    expect(legacyExtension("a.rtf")).toBe("rtf");
    expect(legacyExtension("a.docx")).toBeNull();
    expect(legacyExtension("doc")).toBeNull();
  });
});
