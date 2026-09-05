import { describe, expect, it } from "vitest";

import { loadCustomRegexRules, saveCustomRegexRules } from "./customRules";

describe("custom regex rule storage", () => {
  it("keeps rules in local storage", () => {
    const storage = new MemoryStorage();
    const rules = [
      {
        id: "rule-1",
        name: "Sygnatura",
        pattern: "ABC-[A-Z]+",
        label: "Sygnatura",
        enabled: true,
      },
    ];

    saveCustomRegexRules(rules, storage);

    expect(loadCustomRegexRules(storage)).toEqual(rules);
  });

  it("returns an empty list for invalid stored data", () => {
    const storage = new MemoryStorage();
    storage.setItem("anonymizer.customRegexRules.v1", "{bad");

    expect(loadCustomRegexRules(storage)).toEqual([]);
  });

  it("returns an empty list when nothing is stored yet", () => {
    const storage = new MemoryStorage();

    expect(loadCustomRegexRules(storage)).toEqual([]);
  });

  it("returns an empty list when the stored JSON is not an array", () => {
    const storage = new MemoryStorage();
    storage.setItem("anonymizer.customRegexRules.v1", JSON.stringify({ not: "an array" }));

    expect(loadCustomRegexRules(storage)).toEqual([]);
  });

  it("filters out malformed entries from an otherwise valid array", () => {
    const storage = new MemoryStorage();
    const validRule = {
      id: "rule-1",
      name: "Sygnatura",
      pattern: "ABC-[A-Z]+",
      label: "Sygnatura",
      enabled: true,
    };
    storage.setItem(
      "anonymizer.customRegexRules.v1",
      JSON.stringify([validRule, { id: "rule-2", name: "Niepelna" }, null, "not-an-object"]),
    );

    expect(loadCustomRegexRules(storage)).toEqual([validRule]);
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
