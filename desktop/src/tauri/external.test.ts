import { afterEach, describe, expect, it, vi } from "vitest";

const open = vi.fn();

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: (...args: unknown[]) => open(...args),
}));

import { openExternalUrl } from "./external";

afterEach(() => {
  vi.restoreAllMocks();
  open.mockReset();
});

describe("openExternalUrl", () => {
  it("opens the URL via the Tauri shell plugin", async () => {
    open.mockResolvedValue(undefined);

    await openExternalUrl("https://www.lawtern.com");

    expect(open).toHaveBeenCalledWith("https://www.lawtern.com");
  });

  it("falls back to window.open when the shell plugin fails", async () => {
    open.mockRejectedValue(new Error("shell unavailable"));
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternalUrl("https://www.kancelariapaszkiewicz.pl");

    expect(windowOpen).toHaveBeenCalledWith(
      "https://www.kancelariapaszkiewicz.pl",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
