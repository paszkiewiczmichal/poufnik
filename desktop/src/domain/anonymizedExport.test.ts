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
});
