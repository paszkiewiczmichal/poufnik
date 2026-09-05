import { afterEach, describe, expect, it, vi } from "vitest";

const relaunch = vi.fn();

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunch(...args),
}));

import {
  checkForUpdate,
  getUpdateConsent,
  installUpdate,
  saveUpdateConsent,
  shouldCheckForUpdates,
  UPDATE_CHECK_INTERVAL_MS,
} from "./updater";

afterEach(() => {
  relaunch.mockReset();
});

describe("desktop updater consent gate", () => {
  it("does not call updater check when consent is false", async () => {
    const storage = new MemoryStorage();
    saveUpdateConsent(false, storage);
    const checkImpl = vi.fn();

    const result = await checkForUpdate({ storage, checkImpl });

    expect(result).toEqual({ status: "skipped" });
    expect(checkImpl).not.toHaveBeenCalled();
  });

  it("limits scheduled checks to once per 24 hours", () => {
    const now = 1_700_000_000_000;

    expect(shouldCheckForUpdates(true, null, now)).toBe(true);
    expect(shouldCheckForUpdates(true, now - UPDATE_CHECK_INTERVAL_MS + 1, now)).toBe(false);
    expect(shouldCheckForUpdates(true, now - UPDATE_CHECK_INTERVAL_MS, now)).toBe(true);
  });

  it("getUpdateConsent reads null, true, and false from storage", () => {
    const storage = new MemoryStorage();

    expect(getUpdateConsent(storage)).toBeNull();

    saveUpdateConsent(true, storage);
    expect(getUpdateConsent(storage)).toBe(true);

    saveUpdateConsent(false, storage);
    expect(getUpdateConsent(storage)).toBe(false);
  });

  it("clears the last-check timestamp when consent is revoked", () => {
    const storage = new MemoryStorage();
    storage.setItem("anonymizer.updates.lastCheckAt", "123");

    saveUpdateConsent(false, storage);

    expect(storage.getItem("anonymizer.updates.lastCheckAt")).toBeNull();
  });

  it("runs the update check and reports an available update", async () => {
    const storage = new MemoryStorage();
    saveUpdateConsent(true, storage);
    const update = { version: "1.2.3" };
    const checkImpl = vi.fn().mockResolvedValue(update);

    const result = await checkForUpdate({ storage, checkImpl, now: 1_700_000_000_000 });

    expect(result).toEqual({ status: "available", update });
    expect(checkImpl).toHaveBeenCalledWith({ timeout: 30000 });
    expect(storage.getItem("anonymizer.updates.lastCheckAt")).toBe("1700000000000");
  });

  it("reports no update when the check resolves to null", async () => {
    const storage = new MemoryStorage();
    saveUpdateConsent(true, storage);
    const checkImpl = vi.fn().mockResolvedValue(null);

    await expect(checkForUpdate({ storage, checkImpl })).resolves.toEqual({ status: "none" });
  });

  it("skips a scheduled check that ran too recently unless forced", async () => {
    const now = 1_700_000_000_000;
    const storage = new MemoryStorage();
    saveUpdateConsent(true, storage);
    storage.setItem("anonymizer.updates.lastCheckAt", String(now - 1000));
    const checkImpl = vi.fn().mockResolvedValue(null);

    await expect(checkForUpdate({ storage, checkImpl, now })).resolves.toEqual({ status: "skipped" });
    expect(checkImpl).not.toHaveBeenCalled();

    await expect(checkForUpdate({ storage, checkImpl, now, force: true })).resolves.toEqual({
      status: "none",
    });
    expect(checkImpl).toHaveBeenCalledTimes(1);
  });
});

describe("installUpdate", () => {
  it("downloads, installs, and relaunches the app", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const onEvent = vi.fn();
    relaunch.mockResolvedValue(undefined);

    await installUpdate({ downloadAndInstall } as never, onEvent);

    expect(downloadAndInstall).toHaveBeenCalledWith(onEvent);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
