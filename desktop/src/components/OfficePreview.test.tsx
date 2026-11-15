import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import { NoPreviewConverterError } from "../tauri/pdf";
import { DocumentPreviewPair } from "./DocumentPreviewPair";

const convertToPdf = vi.hoisted(() => vi.fn());
vi.mock("../tauri/pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tauri/pdf")>()),
  convertToPdf,
}));

// pdf.js needs a canvas; a fake document with a known number of pages is enough here.
const numPages = vi.hoisted(() => ({ value: 2 }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: numPages.value,
      getPage: async () => ({
        getViewport: () => ({ width: 10, height: 10 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }),
    destroy: async () => undefined,
  }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

const pdfBytes = new Blob(["%PDF"], { type: "application/pdf" });

beforeEach(() => {
  numPages.value = 2;
  convertToPdf.mockReset();
  convertToPdf.mockResolvedValue(pdfBytes);
  // jsdom has no canvas: the fake page draws nothing.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderXlsxPair() {
  const original = new File(["x"], "arkusz.xlsx");
  const saved = new Blob(["y"]);
  render(
    <DocumentPreviewPair
      original={{ file: original, kind: "office", format: "xlsx" }}
      loadAnonymized={async () => ({ blob: saved, kind: "office", notice: null, format: "xlsx" })}
      version="v1"
    />,
  );
  return { original, saved };
}

describe("preview of spreadsheets and presentations", () => {
  it("asks for a PDF of both the original and the anonymized file", async () => {
    const { original, saved } = renderXlsxPair();

    await vi.waitFor(() => expect(convertToPdf).toHaveBeenCalledTimes(2));
    const calls = convertToPdf.mock.calls;
    expect(calls).toContainEqual([original, "xlsx"]);
    expect(calls).toContainEqual([saved, "xlsx"]);
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".file-preview__page")).toHaveLength(4),
    );
  });

  it("says Office or LibreOffice is needed instead of leaving the pane empty", async () => {
    convertToPdf.mockRejectedValue(new NoPreviewConverterError());
    renderXlsxPair();

    await vi.waitFor(() => expect(screen.getAllByText(texts.preview.needsOffice)).toHaveLength(2));
    expect(texts.preview.needsOffice).toBe("Podgląd wymaga Microsoft Office albo LibreOffice.");
    expect(screen.queryByText(texts.preview.failed)).toBeNull();
  });

  it("shows a loading state while the program converts, and a failure for other errors", async () => {
    let finish: (pdf: Blob) => void = () => undefined;
    convertToPdf.mockReturnValue(new Promise<Blob>((resolve) => (finish = resolve)));
    renderXlsxPair();
    expect((await screen.findAllByText(texts.preview.converting)).length).toBeGreaterThan(0);
    finish(pdfBytes);
    await vi.waitFor(() => expect(screen.queryByText(texts.preview.converting)).toBeNull());

    cleanup();
    convertToPdf.mockRejectedValue(new Error("Microsoft Excel nie utworzył pliku."));
    renderXlsxPair();
    await vi.waitFor(() => expect(screen.getAllByText(texts.preview.failed)).toHaveLength(2));
  });

  it("draws at most the first pages and says how many are left", async () => {
    numPages.value = 75;
    renderXlsxPair();

    await vi.waitFor(() => expect(screen.getAllByText(texts.preview.morePages(15))).toHaveLength(2));
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".file-preview__page")).toHaveLength(120),
    );
  });
});
