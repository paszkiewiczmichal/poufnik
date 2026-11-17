import { describe, expect, it, vi } from "vitest";

import { ApiError, type AnonymizerApiClient } from "../api/client";
import { texts } from "../i18n";
import type { ProcessedDocument } from "../types";
import { buildOwnFormatExport, ownExportFormat, pictureNotice } from "./anonymizedExport";

function documentOf(format: string): ProcessedDocument {
  return {
    filename: `plik.${format}`,
    format,
    source: "parsed",
    page_count: 1,
    text: "Jan Kowalski",
  } as unknown as ProcessedDocument;
}

function clientWith(exportInPlace: () => Promise<Blob>) {
  return {
    exportInPlace: vi.fn(exportInPlace),
    exportDocument: vi.fn(async () => new Blob(["simplified"])),
  };
}

const SOURCE = {
  sourceFile: new File(["bytes"], "plik"),
  anonymizedText: "[OSOBA_1]",
  offsetMap: [],
};

describe("ownExportFormat", () => {
  it("offers the own format only where the engine edits files in place", () => {
    for (const format of ["xlsx", "pptx", "odt", "ods", "odp", "png", "jpg", "heic"]) {
      expect(ownExportFormat(documentOf(format))).toBe(format);
    }
    for (const format of ["docx", "pdf", "txt"]) {
      expect(ownExportFormat(documentOf(format))).toBeNull();
    }
    expect(ownExportFormat(null)).toBeNull();
  });
});

describe("buildOwnFormatExport", () => {
  it("names a HEIC the engine returned as JPEG by the format it really has", async () => {
    const client = clientWith(async () => new Blob(["jpg"], { type: "image/jpeg" }));

    const result = await buildOwnFormatExport(client as unknown as AnonymizerApiClient, {
      ...SOURCE,
      document: documentOf("heic"),
    });

    expect(result.extension).toBe("jpg");
    expect(result.notice).toBeNull();
    expect(client.exportInPlace).toHaveBeenCalledWith(expect.objectContaining({ kind: "image" }));
  });

  it("falls back to a simplified DOCX for an office file the engine refuses", async () => {
    const client = clientWith(async () => {
      throw new ApiError(new Response(null, { status: 422 }), null);
    });

    const result = await buildOwnFormatExport(client as unknown as AnonymizerApiClient, {
      ...SOURCE,
      document: documentOf("ods"),
    });

    expect(result.extension).toBe("docx");
    expect(result.notice).toBe(texts.generation.exportFaithfulFailed);
    expect(client.exportDocument).toHaveBeenCalledWith(
      expect.objectContaining({ anonymizedText: "[OSOBA_1]", format: "docx" }),
    );
  });

  it("does not hide unexpected errors behind a fallback", async () => {
    const client = clientWith(async () => {
      throw new Error("network down");
    });

    await expect(
      buildOwnFormatExport(client as unknown as AnonymizerApiClient, {
        ...SOURCE,
        document: documentOf("xlsx"),
      }),
    ).rejects.toThrow("network down");
    expect(client.exportDocument).not.toHaveBeenCalled();
  });
});

describe("pictureNotice", () => {
  it("tells what was done to pictures inside the office file, in Polish", async () => {
    const painted = Object.assign(new Blob(["xlsx"]), {
      notices: ["pictures_redacted", "pictures_not_checked", "unknown_code"],
    });
    const client = clientWith(async () => painted);

    const result = await buildOwnFormatExport(
      client as unknown as AnonymizerApiClient,
      { ...SOURCE, document: documentOf("xlsx") },
    );

    expect(result.notice).toBe(
      `${texts.generation.pictureNotices.pictures_redacted} ${texts.generation.pictureNotices.pictures_not_checked}`,
    );
    expect(pictureNotice(new Blob(["x"]))).toBeNull();
  });

  it("counts the painted faces with the right Polish plural", () => {
    const notice = (code: string) => pictureNotice(Object.assign(new Blob(["x"]), { notices: [code] }));

    expect(notice("faces_masked:1")).toBe("Zamalowano 1 twarz na zdjęciach lub skanach.");
    expect(notice("faces_masked:3")).toBe("Zamalowano 3 twarze na zdjęciach lub skanach.");
    expect(notice("faces_masked:5")).toBe("Zamalowano 5 twarzy na zdjęciach lub skanach.");
    expect(notice("faces_masked:12")).toBe("Zamalowano 12 twarzy na zdjęciach lub skanach.");
    expect(notice("faces_masked:22")).toBe("Zamalowano 22 twarze na zdjęciach lub skanach.");
  });
});

describe("recognised identity documents", () => {
  it("names each kind of recognised document once", () => {
    const notice = (...codes: string[]) =>
      pictureNotice(Object.assign(new Blob(["x"]), { notices: codes }));

    expect(notice("document_layout:dowod-osobisty-2021-awers", "document_layout:dowod-osobisty-2021-rewers")).toBe(
      "Rozpoznano dowód osobisty: jego pola zamalowano według wzoru z Rejestru Dokumentów Publicznych.",
    );
    expect(notice("faces_masked:1", "document_layout:paszport-2018-dane", "document_layout:prawo-jazdy-2019-awers")).toBe(
      "Zamalowano 1 twarz na zdjęciach lub skanach. Rozpoznano paszport, prawo jazdy: ich pola zamalowano według wzoru z Rejestru Dokumentów Publicznych.",
    );
  });
});

describe("values read by the second OCR engine", () => {
  it("reports the painted values with the right Polish plural", () => {
    const notice = (code: string) => pictureNotice(Object.assign(new Blob(["x"]), { notices: [code] }));

    expect(notice("second_engine_masks:1")).toBe("Dodatkowo zamalowano 1 wartość odczytaną drugim silnikiem OCR.");
    expect(notice("second_engine_masks:2")).toBe("Dodatkowo zamalowano 2 wartości odczytane drugim silnikiem OCR.");
    expect(notice("second_engine_masks:7")).toBe("Dodatkowo zamalowano 7 wartości odczytanych drugim silnikiem OCR.");
  });
});

describe("unread scan pages", () => {
  it("names one page in the singular", () => {
    expect(texts.generation.unreadPages([3])).toBe(
      "Strona 3 wygląda na zapisaną, ale nie udało się z niej odczytać tekstu. Sprawdź ją ręcznie przed wysłaniem - dane na niej mogły nie zostać zamaskowane.",
    );
  });

  it("joins several pages in the plural", () => {
    expect(texts.generation.unreadPages([3, 5])).toBe(
      "Strony 3 i 5 wyglądają na zapisane, ale nie udało się z nich odczytać tekstu. Sprawdź je ręcznie przed wysłaniem - dane na nich mogły nie zostać zamaskowane.",
    );
    expect(texts.generation.unreadPages([2, 4, 7])).toContain("Strony 2, 4 i 7 wyglądają");
    expect(texts.generation.unreadPages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toContain(
      "Strony 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 i 2 innych wyglądają",
    );
  });

  it("adds the warning to the export notice, after the other notices", async () => {
    const painted = Object.assign(new Blob(["xlsx"]), { notices: ["pictures_redacted"] });
    const client = clientWith(async () => painted);
    const document = { ...documentOf("xlsx"), unread_pages: [3, 5] } as ProcessedDocument;

    const result = await buildOwnFormatExport(client as unknown as AnonymizerApiClient, {
      ...SOURCE,
      document,
    });

    expect(result.notice).toBe(
      `${texts.generation.pictureNotices.pictures_redacted} ${texts.generation.unreadPages([3, 5])}`,
    );
  });

  it("leaves the export notice alone when every page was read", async () => {
    const client = clientWith(async () => new Blob(["xlsx"]));
    const document = { ...documentOf("xlsx"), unread_pages: [] } as ProcessedDocument;

    const result = await buildOwnFormatExport(client as unknown as AnonymizerApiClient, {
      ...SOURCE,
      document,
    });

    expect(result.notice).toBeNull();
  });
});
