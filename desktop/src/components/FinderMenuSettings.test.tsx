import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import macosConfig from "../../src-tauri/tauri.macos.conf.json";
import { texts } from "../i18n";
import { openExternalUrl } from "../tauri/external";
import { FinderMenuSettings, MAC_EXTENSIONS_SETTINGS_URL } from "./FinderMenuSettings";

vi.mock("../tauri/external", () => ({ openExternalUrl: vi.fn(() => Promise.resolve()) }));

afterEach(cleanup);

describe("FinderMenuSettings", () => {
  it("opens the macOS extensions settings, nothing else", () => {
    render(<FinderMenuSettings />);

    fireEvent.click(screen.getByRole("button", { name: texts.finderMenu.open }));

    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    expect(openExternalUrl).toHaveBeenCalledWith("x-apple.systempreferences:com.apple.ExtensionsPreferences");
    expect(MAC_EXTENSIONS_SETTINGS_URL).toBe("x-apple.systempreferences:com.apple.ExtensionsPreferences");
  });

  it("is the only system-settings address the shell may open on macOS", () => {
    // Tauri anchors the configured expression at both ends.
    const allowed = new RegExp(`^${macosConfig.plugins.shell.open}$`);

    expect(allowed.test(MAC_EXTENSIONS_SETTINGS_URL)).toBe(true);
    expect(allowed.test("https://poufnik.app")).toBe(true);
    expect(allowed.test("x-apple.systempreferences:com.apple.preference.security")).toBe(false);
    expect(allowed.test("file:///etc/passwd")).toBe(false);
  });
});
