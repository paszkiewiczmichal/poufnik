import { afterEach, describe, expect, it, vi } from "vitest";

const writeText = vi.fn();
const readText = vi.fn();

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (...args: unknown[]) => writeText(...args),
  readText: (...args: unknown[]) => readText(...args),
}));

import { copyText, readClipboardText } from "./clipboard";

afterEach(() => {
  writeText.mockReset();
  readText.mockReset();
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("writes through the Tauri clipboard plugin", async () => {
    writeText.mockResolvedValue(undefined);

    await copyText("dane wrażliwe");

    expect(writeText).toHaveBeenCalledWith("dane wrażliwe");
  });

  it("falls back to the browser clipboard API when the plugin fails", async () => {
    writeText.mockRejectedValue(new Error("plugin unavailable"));
    const browserWrite = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: browserWrite } });

    await copyText("dane wrażliwe");

    expect(browserWrite).toHaveBeenCalledWith("dane wrażliwe");
  });

  it("throws when neither the plugin nor the browser API is available", async () => {
    writeText.mockRejectedValue(new Error("plugin unavailable"));
    Object.assign(navigator, { clipboard: undefined });

    await expect(copyText("dane wrażliwe")).rejects.toThrow("Clipboard is unavailable.");
  });
});

describe("readClipboardText", () => {
  it("reads through the Tauri clipboard plugin", async () => {
    readText.mockResolvedValue("skopiowany tekst");

    await expect(readClipboardText()).resolves.toBe("skopiowany tekst");
  });
});
