import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exists = vi.fn();
const mkdir = vi.fn();
const readTextFile = vi.fn();
const remove = vi.fn();
const writeTextFile = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppLocalData: "AppLocalData" },
  exists: (...args: unknown[]) => exists(...args),
  mkdir: (...args: unknown[]) => mkdir(...args),
  readTextFile: (...args: unknown[]) => readTextFile(...args),
  remove: (...args: unknown[]) => remove(...args),
  writeTextFile: (...args: unknown[]) => writeTextFile(...args),
}));

import {
  clearStoredAuthToken,
  getStoredBasicChoice,
  readStoredAuthToken,
  saveStoredAuthToken,
  saveStoredBasicChoice,
} from "./sessionStorage";

function setTauriRuntime(isTauri: boolean) {
  if (isTauri) {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
  } else {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  }
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  setTauriRuntime(false);
});

describe("readStoredAuthToken (browser runtime)", () => {
  it("returns null when nothing is stored", async () => {
    setTauriRuntime(false);

    await expect(readStoredAuthToken()).resolves.toBeNull();
  });

  it("returns the token saved via saveStoredAuthToken", async () => {
    setTauriRuntime(false);
    await saveStoredAuthToken("token-abc");

    await expect(readStoredAuthToken()).resolves.toBe("token-abc");
  });

  it("returns null for corrupted stored JSON", async () => {
    setTauriRuntime(false);
    window.localStorage.setItem("poufnik.auth.session", "{not json");

    await expect(readStoredAuthToken()).resolves.toBeNull();
  });
});

describe("readStoredAuthToken (Tauri runtime)", () => {
  it("reads the token from the Tauri session file when it exists", async () => {
    setTauriRuntime(true);
    exists.mockResolvedValue(true);
    readTextFile.mockResolvedValue('{"accessToken":"tauri-token"}');

    await expect(readStoredAuthToken()).resolves.toBe("tauri-token");
  });

  it("returns null when the session file does not exist", async () => {
    setTauriRuntime(true);
    exists.mockResolvedValue(false);

    await expect(readStoredAuthToken()).resolves.toBeNull();
  });

  it("falls back to the browser copy if reading the Tauri file throws", async () => {
    setTauriRuntime(true);
    exists.mockRejectedValue(new Error("fs unavailable"));
    window.localStorage.setItem(
      "poufnik.auth.session",
      JSON.stringify({ accessToken: "fallback-token" }),
    );

    await expect(readStoredAuthToken()).resolves.toBe("fallback-token");
  });
});

describe("saveStoredAuthToken", () => {
  it("always writes the browser copy, even in Tauri runtime", async () => {
    setTauriRuntime(true);
    mkdir.mockResolvedValue(undefined);
    writeTextFile.mockResolvedValue(undefined);

    await saveStoredAuthToken("token-xyz");

    expect(window.localStorage.getItem("poufnik.auth.session")).toContain("token-xyz");
    expect(mkdir).toHaveBeenCalledWith("auth", { baseDir: "AppLocalData", recursive: true });
    expect(writeTextFile).toHaveBeenCalled();
  });

  it("does not throw when the Tauri file write fails", async () => {
    setTauriRuntime(true);
    mkdir.mockRejectedValue(new Error("no permission"));

    await expect(saveStoredAuthToken("token-xyz")).resolves.toBeUndefined();
  });
});

describe("clearStoredAuthToken", () => {
  it("removes the browser copy", async () => {
    setTauriRuntime(false);
    await saveStoredAuthToken("token-abc");

    await clearStoredAuthToken();

    expect(window.localStorage.getItem("poufnik.auth.session")).toBeNull();
  });

  it("removes the Tauri session file when present", async () => {
    setTauriRuntime(true);
    exists.mockResolvedValue(true);
    remove.mockResolvedValue(undefined);

    await clearStoredAuthToken();

    expect(remove).toHaveBeenCalledWith("auth/session.json", { baseDir: "AppLocalData" });
  });

  it("does not throw when removing the Tauri file fails", async () => {
    setTauriRuntime(true);
    exists.mockRejectedValue(new Error("fs unavailable"));

    await expect(clearStoredAuthToken()).resolves.toBeUndefined();
  });
});

describe("basic-tier choice persistence", () => {
  it("defaults to false and round-trips true/false", () => {
    expect(getStoredBasicChoice()).toBe(false);

    saveStoredBasicChoice(true);
    expect(getStoredBasicChoice()).toBe(true);

    saveStoredBasicChoice(false);
    expect(getStoredBasicChoice()).toBe(false);
  });
});
