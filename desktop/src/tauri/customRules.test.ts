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
