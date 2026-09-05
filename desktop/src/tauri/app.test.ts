import { describe, expect, it, vi } from "vitest";

const getVersion = vi.fn(async () => "1.2.3");

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: (...args: unknown[]) => getVersion(...args),
}));

import { getAppVersion } from "./app";

describe("getAppVersion", () => {
  it("returns the real Tauri app version", async () => {
    await expect(getAppVersion()).resolves.toBe("1.2.3");
  });
});
