import { describe, expect, it } from "vitest";

import { loadExcludedCategories, saveExcludedCategories } from "./excludedCategories";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe("excluded categories setting", () => {
  it("is empty until the user turns a category off", () => {
    expect(loadExcludedCategories(memoryStorage())).toEqual([]);
  });

  it("keeps the saved categories across restarts", () => {
    const storage = memoryStorage();
    saveExcludedCategories(["MONEY", "DATE"], storage);

    expect(loadExcludedCategories(storage)).toEqual(["DATE", "MONEY"]);
  });

  it("ignores unknown names and broken values instead of failing", () => {
    expect(
      loadExcludedCategories(
        memoryStorage({ "anonymizer.excludedCategories.v1": '["DATE","NO_SUCH"]' }),
      ),
    ).toEqual(["DATE"]);
    expect(
      loadExcludedCategories(memoryStorage({ "anonymizer.excludedCategories.v1": "{oops" })),
    ).toEqual([]);
  });
});
