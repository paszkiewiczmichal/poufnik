import { describe, expect, it } from "vitest";

import { loadMaskFaces, saveMaskFaces } from "./replacementMode";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe("mask faces setting", () => {
  it("is on until the user turns it off", () => {
    expect(loadMaskFaces(memoryStorage())).toBe(true);
  });

  it("keeps the choice across restarts, both ways", () => {
    const storage = memoryStorage();
    saveMaskFaces(false, storage);
    expect(loadMaskFaces(storage)).toBe(false);

    saveMaskFaces(true, storage);
    expect(loadMaskFaces(storage)).toBe(true);
  });

  it("stays on when the stored value is garbage or storage fails", () => {
    expect(loadMaskFaces(memoryStorage({ "anonymizer.maskFaces.v1": "maybe" }))).toBe(true);
    expect(
      loadMaskFaces({
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => undefined,
      }),
    ).toBe(true);
  });
});
