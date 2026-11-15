import { beforeEach, describe, expect, it, vi } from "vitest";

import { convertToPdf, NoPreviewConverterError } from "./pdf";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

beforeEach(() => invoke.mockReset());

describe("convertToPdf", () => {
  it("sends the bytes with the file format and returns a PDF blob", async () => {
    invoke.mockResolvedValue(new TextEncoder().encode("%PDF-1.7").buffer);
    const pdf = await convertToPdf(new Blob(["abc"]), "pptx");

    const [command, bytes, options] = invoke.mock.calls[0];
    expect(command).toBe("convert_to_pdf");
    expect(Array.from(bytes as Uint8Array)).toEqual([97, 98, 99]);
    expect(options).toEqual({ headers: { "x-poufnik-extension": "pptx" } });
    expect(pdf.type).toBe("application/pdf");
  });

  it("reports a missing converter, also outside the desktop shell", async () => {
    invoke.mockRejectedValueOnce("no_renderer");
    await expect(convertToPdf(new Blob(["x"]), "xlsx")).rejects.toBeInstanceOf(
      NoPreviewConverterError,
    );
    invoke.mockRejectedValueOnce(new TypeError("invoke is not available"));
    await expect(convertToPdf(new Blob(["x"]), "xlsx")).rejects.toBeInstanceOf(
      NoPreviewConverterError,
    );
  });

  it("keeps the message of any other failure", async () => {
    invoke.mockRejectedValueOnce("Microsoft Excel nie odpowiada.");
    await expect(convertToPdf(new Blob(["x"]), "xlsx")).rejects.toThrow(
      "Microsoft Excel nie odpowiada.",
    );
  });
});
