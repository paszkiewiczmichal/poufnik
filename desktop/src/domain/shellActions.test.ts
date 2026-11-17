import { describe, expect, it, vi } from "vitest";

import { ApiError, type AnonymizerApiClient } from "../api/client";
import { texts } from "../i18n";
import type { DocumentProcessResponse, ReplacementMap } from "../types";
import { runShellAction, type ShellActionDeps } from "./shellActions";

const ORIGINAL = "Umowa zawarta z Janem Testowym, tel. 600 100 200.";
const ANONYMIZED = "Umowa zawarta z [OSOBA_1], tel. [TELEFON_1].";
// Restoring puts back the canonical (nominative) form, not the inflected original.
const RESTORED = "Umowa zawarta z Jan Testowy, tel. 600 100 200.";

function mapOf(...pairs: [string, string][]): ReplacementMap {
  return {
    entries: pairs.map(([token, canonical]) => ({
      token,
      category: "PERSON",
      canonical_text: canonical,
    })),
  } as ReplacementMap;
}

const DOCUMENT_MAP = mapOf(["[OSOBA_1]", "Jan Testowy"], ["[TELEFON_1]", "600 100 200"]);

function processed(
  format: "docx" | "pdf" | "txt" | "png" | "jpg" | "xlsx",
  filename: string,
  text = ORIGINAL,
): DocumentProcessResponse {
  return {
    document: { filename, format, source: format === "png" || format === "jpg" ? "ocr" : "parsed", page_count: 1, text },
    entities: [],
    anonymized_text: ANONYMIZED,
    replacement_map: DOCUMENT_MAP,
    offset_map: [],
  } as unknown as DocumentProcessResponse;
}

function setup(options: {
  filename: string;
  format: "docx" | "pdf" | "txt" | "png" | "jpg" | "xlsx";
  existing?: string[];
  text?: string;
  /** Text the engine reads from a DOCX/PDF (an anonymized file being restored). */
  documentText?: string;
  maps?: ReplacementMap[];
  restoreDocx?: () => Promise<Blob>;
  removed?: string[];
  notices?: string[];
  exportInPlace?: () => Promise<Blob>;
}) {
  const written = new Map<string, Blob | string>();
  const remembered: ReplacementMap[] = [];
  const rememberedNames: { sourceName: string | null; outputName: string | null }[] = [];
  const copied: string[] = [];
  const client = {
    processDocument: vi.fn(async () =>
      processed(options.format, options.filename, options.documentText),
    ),
    restoreDocxInPlace: vi.fn(options.restoreDocx ?? (async () => new Blob(["docx-restored"]))),
    exportInPlace: vi.fn(
      options.exportInPlace ?? (async () => new Blob(["in-place"], { type: "image/png" })),
    ),
    cleanMetadata: vi.fn(async () => ({
      blob: new Blob(["clean"]),
      removed: options.removed ?? ["exif", "gps"],
      notices: options.notices ?? [],
    })),
    exportDocxInPlace: vi.fn(async () => new Blob(["docx-in-place"])),
    exportPdfInPlace: vi.fn(async () => new Blob(["pdf-in-place"])),
    exportDocument: vi.fn(async () => new Blob(["simplified"])),
    deanonymize: vi.fn(async (text: string, map: ReplacementMap) => ({
      original_text: map.entries.reduce(
        (result, entry) => result.split(entry.token).join(entry.canonical_text),
        text,
      ),
      warnings: [],
    })),
  };
  const existing = new Set(options.existing ?? []);
  const deps: ShellActionDeps = {
    client: client as unknown as AnonymizerApiClient,
    readDocument: async (path) => new File(["bytes"], path.split("\\").pop()!),
    readText: async () => options.text ?? "",
    writeFile: async (path, contents) => {
      written.set(path, contents);
    },
    exists: async (path) => existing.has(path) || written.has(path),
    copyText: async (text) => {
      copied.push(text);
    },
    applyUserSettings: async (_client, response) => response,
    exportPlatform: {
      getPdfRenderer: async () => null,
      renderDocxToPdf: async () => new Blob(["rendered"]),
      isMacAppStore: false,
    },
    rememberMap: async (map, names) => {
      remembered.push(map);
      rememberedNames.push(names);
    },
    findMaps: async () =>
      (options.maps ?? []).map((map) => ({
        map,
        sourceName: null,
        outputName: null,
        mapFileName: null,
        savedAt: null,
      })),
  };
  return { deps, client, written, remembered, rememberedNames, copied };
}

describe("runShellAction", () => {
  it("anonymizes a DOCX in place and saves it next to the original without overwriting", async () => {
    const { deps, client, written, remembered, rememberedNames } = setup({
      filename: "umowa.docx",
      format: "docx",
      existing: ["C:\\Akta\\umowa_poufnik.docx"],
    });

    const outcome = await runShellAction("anonymize", "C:\\Akta\\umowa.docx", deps);

    expect(outcome).toMatchObject({ ok: true, outputPath: "C:\\Akta\\umowa_poufnik (2).docx" });
    expect(client.exportDocxInPlace).toHaveBeenCalledOnce();
    expect(await (written.get("C:\\Akta\\umowa_poufnik (2).docx") as Blob).text()).toBe(
      "docx-in-place",
    );
    expect(remembered).toEqual([DOCUMENT_MAP]);
    expect(rememberedNames).toEqual([
      { sourceName: "umowa.docx", outputName: "umowa_poufnik.docx" },
    ]);
  });

  it("anonymizes a photo in its own format, with the values painted over", async () => {
    const { deps, client, written } = setup({ filename: "skan.png", format: "png" });

    const outcome = await runShellAction("anonymize", "C:\\Akta\\skan.png", deps);

    expect(outcome).toMatchObject({
      ok: true,
      outputPath: "C:\\Akta\\skan_poufnik.png",
      notice: null,
    });
    expect(client.exportInPlace).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "image", anonymizedText: ANONYMIZED }),
    );
    expect(client.exportDocument).not.toHaveBeenCalled();
    expect(written.has("C:\\Akta\\skan_poufnik.png")).toBe(true);
  });

  it("anonymizes a spreadsheet in place and keeps it a spreadsheet", async () => {
    const { deps, client, written } = setup({ filename: "lista.xlsx", format: "xlsx" });

    const outcome = await runShellAction("anonymize", "C:\\Akta\\lista.xlsx", deps);

    expect(outcome).toMatchObject({ ok: true, outputPath: "C:\\Akta\\lista_poufnik.xlsx" });
    expect(client.exportInPlace).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "xlsx", offsetMap: [] }),
    );
    expect(written.has("C:\\Akta\\lista_poufnik.xlsx")).toBe(true);
  });

  it("falls back to a simplified PDF built from the text when a photo cannot be painted safely", async () => {
    const refusal = new ApiError(new Response(null, { status: 400 }), null);
    const { deps, client, written } = setup({
      filename: "skan.jpg",
      format: "jpg",
      exportInPlace: async () => {
        throw refusal;
      },
    });

    const outcome = await runShellAction("anonymize", "C:\\Akta\\skan.jpg", deps);

    expect(outcome).toMatchObject({
      ok: true,
      outputPath: "C:\\Akta\\skan_poufnik.pdf",
      notice: texts.generation.exportFaithfulFailed,
    });
    expect(client.exportDocument).toHaveBeenCalledWith(
      expect.objectContaining({ anonymizedText: ANONYMIZED, format: "pdf" }),
    );
    expect(written.has("C:\\Akta\\skan_poufnik.pdf")).toBe(true);
  });

  it("writes anonymized text for a TXT source", async () => {
    const { deps, written } = setup({ filename: "notatka.txt", format: "txt" });

    await runShellAction("anonymize", "C:\\Akta\\notatka.txt", deps);

    expect(written.get("C:\\Akta\\notatka_poufnik.txt")).toBe(ANONYMIZED);
  });

  it("OCR keeps the raw text, saves it and copies it, without anonymizing", async () => {
    const { deps, written, copied, remembered } = setup({ filename: "skan.png", format: "png" });

    const outcome = await runShellAction("ocr", "C:\\Akta\\skan.png", deps);

    expect(outcome).toMatchObject({ ok: true, copied: true, outputPath: "C:\\Akta\\skan_tekst.txt" });
    expect(written.get("C:\\Akta\\skan_tekst.txt")).toBe(ORIGINAL);
    expect(copied).toEqual([ORIGINAL]);
    expect(remembered).toEqual([]);
  });

  it("Markdown contains and copies only the anonymized text", async () => {
    const { deps, written, copied, remembered } = setup({ filename: "pismo.pdf", format: "pdf" });

    await runShellAction("markdown", "C:\\Akta\\pismo.pdf", deps);

    expect(written.get("C:\\Akta\\pismo_poufnik.md")).toBe(ANONYMIZED);
    expect(copied).toEqual([ANONYMIZED]);
    expect(copied[0]).not.toContain("Testow");
    expect(remembered).toEqual([DOCUMENT_MAP]);
  });

  it("restores an AI answer with the map whose tokens it uses", async () => {
    const otherMap = mapOf(["[OSOBA_1]", "Anna Inna"]);
    const { deps, written } = setup({
      filename: "odpowiedz.md",
      format: "txt",
      text: "Pan [OSOBA_1] (tel. [TELEFON_1]) powinien odpowiedzieć.",
      maps: [otherMap, DOCUMENT_MAP],
    });

    const outcome = await runShellAction("restore", "C:\\Akta\\odpowiedz.md", deps);

    expect(outcome).toMatchObject({ ok: true, outputPath: "C:\\Akta\\odpowiedz_przywrocone.md" });
    expect(written.get("C:\\Akta\\odpowiedz_przywrocone.md")).toBe(
      "Pan Jan Testowy (tel. 600 100 200) powinien odpowiedzieć.",
    );
  });

  it("restores a DOCX in place, keeping its format", async () => {
    const { deps, written, client } = setup({
      filename: "odpowiedz.docx",
      format: "docx",
      documentText: ANONYMIZED,
      maps: [DOCUMENT_MAP],
    });

    const outcome = await runShellAction("restore", "C:\\Akta\\odpowiedz.docx", deps);

    expect(outcome).toEqual({
      ok: true,
      outputPath: "C:\\Akta\\odpowiedz_przywrocone.docx",
      copied: false,
      notice: null,
    });
    expect(client.restoreDocxInPlace).toHaveBeenCalledWith({
      file: expect.objectContaining({ name: "odpowiedz.docx" }),
      replacementMap: DOCUMENT_MAP,
    });
    expect(await (written.get("C:\\Akta\\odpowiedz_przywrocone.docx") as Blob).text()).toBe(
      "docx-restored",
    );
    expect(client.exportDocument).not.toHaveBeenCalled();
  });

  it("restores an XLSX in place, so it stays a spreadsheet", async () => {
    const { deps, written, client } = setup({
      filename: "zestawienie_poufnik.xlsx",
      format: "xlsx",
      documentText: ANONYMIZED,
      maps: [DOCUMENT_MAP],
    });

    const outcome = await runShellAction("restore", "C:\\Akta\\zestawienie_poufnik.xlsx", deps);

    expect(outcome).toMatchObject({
      ok: true,
      outputPath: "C:\\Akta\\zestawienie_poufnik_przywrocone.xlsx",
    });
    expect(client.restoreDocxInPlace).toHaveBeenCalledWith({
      file: expect.objectContaining({ name: "zestawienie_poufnik.xlsx" }),
      replacementMap: DOCUMENT_MAP,
      kind: "xlsx",
    });
    expect(client.exportDocument).not.toHaveBeenCalled();
    expect(written.has("C:\\Akta\\zestawienie_poufnik_przywrocone.xlsx")).toBe(true);
  });

  it("warns about tokens the engine left in a restored DOCX, mangled ones too", async () => {
    const restored = Object.assign(new Blob(["docx-restored"]), {
      warnings: ["Unknown anonymization token [OSOBA_7] at offset 3."],
    });
    const { deps } = setup({
      filename: "odpowiedz.docx",
      format: "docx",
      documentText: "[OSOBA_1], [OSOBA_7] i [OSOBA 1]",
      maps: [DOCUMENT_MAP],
      restoreDocx: async () => restored,
    });

    const outcome = await runShellAction("restore", "C:\\Akta\\odpowiedz.docx", deps);

    expect(outcome).toMatchObject({
      ok: true,
      notice:
        "W pliku zostały 2 oznaczenia, których nie ma w mapie: [OSOBA_7], [OSOBA 1]. Sprawdź je ręcznie.",
    });
  });

  it("uses the engine's warnings for a text restore too", async () => {
    const { deps, client } = setup({
      filename: "odpowiedz.txt",
      format: "txt",
      text: "[OSOBA_1]",
      maps: [DOCUMENT_MAP],
    });
    client.deanonymize.mockResolvedValueOnce({
      original_text: "Jan Testowy",
      warnings: ["Unknown anonymization token [ADRES_9] at offset 0."],
    });

    const outcome = await runShellAction("restore", "C:\\Akta\\odpowiedz.txt", deps);

    expect(outcome).toMatchObject({
      ok: true,
      notice: texts.restoreWarnings.unknownTokens(["[ADRES_9]"], "file"),
    });
  });

  it("falls back to a simple DOCX with the restored text when the engine refuses", async () => {
    const refusal = new ApiError(new Response(null, { status: 400 }), null);
    const { deps, written, client } = setup({
      filename: "odpowiedz.docx",
      format: "docx",
      documentText: ANONYMIZED,
      maps: [DOCUMENT_MAP],
      restoreDocx: async () => {
        throw refusal;
      },
    });

    const outcome = await runShellAction("restore", "C:\\Akta\\odpowiedz.docx", deps);

    expect(outcome).toMatchObject({
      ok: true,
      outputPath: "C:\\Akta\\odpowiedz_przywrocone.docx",
      notice: texts.shellActions.restoredSimplified,
    });
    expect(client.exportDocument).toHaveBeenCalledWith({
      anonymizedText: RESTORED,
      format: "docx",
      blocks: [{ start: 0, end: RESTORED.length, kind: "paragraph", page: 1 }],
    });
    expect(written.has("C:\\Akta\\odpowiedz_przywrocone.docx")).toBe(true);
  });

  it("restores a PDF as a simple PDF built from the restored text", async () => {
    const { deps, written, client } = setup({
      filename: "odpowiedz.pdf",
      format: "pdf",
      documentText: ANONYMIZED,
      maps: [DOCUMENT_MAP],
    });

    const outcome = await runShellAction("restore", "C:\\Akta\\odpowiedz.pdf", deps);

    expect(outcome).toMatchObject({
      ok: true,
      outputPath: "C:\\Akta\\odpowiedz_przywrocone.pdf",
      notice: texts.shellActions.restoredPdfSimplified,
    });
    expect(client.exportDocument).toHaveBeenCalledWith(
      expect.objectContaining({ anonymizedText: RESTORED, format: "pdf" }),
    );
    expect(client.restoreDocxInPlace).not.toHaveBeenCalled();
    expect(written.has("C:\\Akta\\odpowiedz_przywrocone.pdf")).toBe(true);
  });

  it("keeps a TXT as TXT and names tokens the map does not know", async () => {
    const { deps, written } = setup({
      filename: "odpowiedz.txt",
      format: "txt",
      text: "[OSOBA_1] i [OSOBA_7] oraz znów [OSOBA_7].",
      maps: [DOCUMENT_MAP],
    });

    const outcome = await runShellAction("restore", "C:\\Akta\\odpowiedz.txt", deps);

    expect(outcome).toMatchObject({
      ok: true,
      outputPath: "C:\\Akta\\odpowiedz_przywrocone.txt",
      notice: texts.restoreWarnings.unknownTokens(["[OSOBA_7]"], "file"),
    });
    expect(written.get("C:\\Akta\\odpowiedz_przywrocone.txt")).toBe(
      "Jan Testowy i [OSOBA_7] oraz znów [OSOBA_7].",
    );
  });

  it("removes metadata into a new file next to the original, listing what went", async () => {
    const { deps, written, client } = setup({
      filename: "dowod.jpg",
      format: "png",
      existing: ["C:\\Akta\\dowod_bez_metadanych.jpg"],
    });

    const outcome = await runShellAction("metadata", "C:\\Akta\\dowod.jpg", deps);

    expect(outcome).toEqual({
      ok: true,
      outputPath: "C:\\Akta\\dowod_bez_metadanych (2).jpg",
      copied: false,
      notice: texts.shellActions.metadataRemoved(["exif", "gps"]),
    });
    expect(texts.shellActions.metadataRemoved(["exif", "gps"])).toContain("lokalizacja GPS");
    expect(client.cleanMetadata).toHaveBeenCalledTimes(1);
    expect(client.processDocument).not.toHaveBeenCalled();
    expect(written.has("C:\\Akta\\dowod_bez_metadanych (2).jpg")).toBe(true);
  });

  it("warns that a signature breaks when a signed PDF loses its metadata", async () => {
    const { deps } = setup({
      filename: "podpisany.pdf",
      format: "pdf",
      removed: ["pdf_info"],
      notices: ["signature_invalidated"],
    });

    const outcome = await runShellAction("metadata", "C:\\Akta\\podpisany.pdf", deps);

    expect(outcome).toMatchObject({ ok: true });
    expect(outcome.ok && outcome.notice).toContain(texts.shellActions.metadataSignature);
  });

  it("does not offer metadata cleaning for plain text", async () => {
    const { deps, client } = setup({ filename: "notatka.txt", format: "txt" });

    expect(await runShellAction("metadata", "C:\\Akta\\notatka.txt", deps)).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(client.cleanMetadata).not.toHaveBeenCalled();
  });

  it("does not restore when no map matches the tokens", async () => {
    const { deps, written, client } = setup({
      filename: "odpowiedz.txt",
      format: "txt",
      text: "Bez tokenów.",
      maps: [DOCUMENT_MAP],
    });

    expect(await runShellAction("restore", "C:\\Akta\\odpowiedz.txt", deps)).toEqual({
      ok: false,
      reason: "no_map",
    });
    expect(client.deanonymize).not.toHaveBeenCalled();
    expect(written.size).toBe(0);
  });

  it("does not guess when two remembered maps would put different people back", async () => {
    const otherMap = mapOf(["[OSOBA_1]", "Anna Inna"], ["[TELEFON_1]", "500 000 000"]);
    const { deps, written, client } = setup({
      filename: "odpowiedz.md",
      format: "txt",
      text: "Pan [OSOBA_1] (tel. [TELEFON_1]).",
      maps: [otherMap, DOCUMENT_MAP],
    });

    expect(await runShellAction("restore", "C:\\Akta\\odpowiedz.md", deps)).toEqual({
      ok: false,
      reason: "ambiguous_map",
    });
    expect(client.deanonymize).not.toHaveBeenCalled();
    expect(written.size).toBe(0);
  });

  it("refuses to restore a file type it cannot read", async () => {
    const { deps } = setup({ filename: "zdjecie.png", format: "png" });
    expect(await runShellAction("restore", "C:\\Akta\\zdjecie.png", deps)).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});
