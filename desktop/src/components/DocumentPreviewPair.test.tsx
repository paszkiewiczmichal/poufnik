import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { originalPreviewKind, previewKind } from "../domain/preview";
import { texts } from "../i18n";
import { DocumentPreviewPair } from "./DocumentPreviewPair";

// The page renderers need a real browser; here only what is shown where matters.
vi.mock("./FilePreview", () => ({
  FilePreview: ({ file, kind, label }: { file: Blob; kind: string; label: string }) => (
    <div data-testid={label}>
      {kind}:{(file as File).name ?? file.type}
    </div>
  ),
}));

afterEach(cleanup);

describe("DocumentPreviewPair", () => {
  it("draws the original and the file that export saves, side by side", async () => {
    const original = new File(["x"], "umowa.docx");
    const saved = new File(["y"], "umowa_poufnik.docx");
    const load = vi.fn(async () => ({ blob: saved, kind: "docx" as const, notice: null }));

    render(
      <DocumentPreviewPair
        original={{ file: original, kind: "docx" }}
        loadAnonymized={load}
        version="v1"
      />,
    );

    expect(screen.getByTestId(texts.preview.before)).toHaveTextContent("docx:umowa.docx");
    expect(await screen.findByTestId(texts.preview.after)).toHaveTextContent(
      "docx:umowa_poufnik.docx",
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("builds the file again only when the anonymization changes", async () => {
    const load = vi.fn(async () => ({ blob: new Blob(["y"]), kind: "pdf" as const, notice: null }));
    const { rerender } = render(
      <DocumentPreviewPair original={null} loadAnonymized={load} version="v1" />,
    );
    await screen.findByTestId(texts.preview.after);

    rerender(<DocumentPreviewPair original={null} loadAnonymized={load} version="v1" />);
    rerender(<DocumentPreviewPair original={null} loadAnonymized={load} version="v2" />);

    await screen.findByTestId(texts.preview.after);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("says why the layout is simplified, but not twice", async () => {
    const notice = "Uproszczony układ.";
    const load = async () => ({ blob: new Blob(["y"]), kind: "pdf" as const, notice });
    const { unmount } = render(
      <DocumentPreviewPair original={null} loadAnonymized={load} version="v1" />,
    );
    expect(await screen.findByText(notice)).toBeInTheDocument();
    unmount();

    render(
      <DocumentPreviewPair original={null} loadAnonymized={load} version="v1" shownNotice={notice} />,
    );
    await screen.findByTestId(texts.preview.after);
    expect(screen.queryByText(notice)).toBeNull();
  });

  it("shows the engine's error instead of an empty page", async () => {
    const load = async () => {
      throw new Error("Silnik nie odpowiada.");
    };
    render(<DocumentPreviewPair original={null} loadAnonymized={load} version="v1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Silnik nie odpowiada.");
  });
});

describe("previewKind", () => {
  it("draws PDF, Word, pictures and converted Office files 1:1, leaves TXT to the text view", () => {
    expect(previewKind("pdf")).toBe("pdf");
    expect(previewKind("docx")).toBe("docx");
    expect(previewKind("jpg")).toBe("image");
    expect(previewKind("heic")).toBe("image");
    for (const format of ["xlsx", "ods", "pptx", "odp", "odt"]) {
      expect(previewKind(format)).toBe("office");
    }
    for (const format of ["txt", "doc", undefined]) {
      expect(previewKind(format)).toBeNull();
    }
  });

  it("does not try to draw an original HEIC photo the webview cannot decode", () => {
    const photo = new File(["x"], "zdjecie.heic");
    expect(originalPreviewKind(photo, "heic")).toBeNull();
    expect(originalPreviewKind(photo, "jpg")).toBe("image");
    expect(originalPreviewKind(null, "pdf")).toBeNull();
  });
});
