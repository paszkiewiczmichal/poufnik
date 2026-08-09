import { describe, expect, it, vi } from "vitest";

import {
  checkForUpdate,
  saveUpdateConsent,
  shouldCheckForUpdates,
  UPDATE_CHECK_INTERVAL_MS,
} from "./updater";

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
