import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { getPdfRenderer, renderDocxToPdf } from "./pdf";

describe("pdf rendering bridge", () => {
  it("sends DOCX bytes as a raw body and returns a PDF blob", async () => {
    invoke.mockResolvedValueOnce(new TextEncoder().encode("%PDF-1.7").buffer);

    const pdf = await renderDocxToPdf(new Blob(["PK-docx"]));

    const [command, body] = invoke.mock.calls[0] as [string, Uint8Array];
    expect(command).toBe("render_docx_to_pdf");
    // A typed array (not a JSON object) is what Tauri sends as a raw request body.
    expect(ArrayBuffer.isView(body)).toBe(true);
    expect(new TextDecoder().decode(body)).toBe("PK-docx");
    expect(pdf.type).toBe("application/pdf");
    expect(await pdf.text()).toBe("%PDF-1.7");
  });

  it("reports no renderer when the desktop shell is unavailable", async () => {
    invoke.mockRejectedValueOnce(new Error("no tauri"));

    await expect(getPdfRenderer()).resolves.toBeNull();
  });
});
