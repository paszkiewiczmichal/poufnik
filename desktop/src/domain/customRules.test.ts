import { describe, expect, it } from "vitest";

import {
  createCustomRule,
  customRuleMatches,
  enabledCustomRulePayloads,
  MAX_CUSTOM_RULE_PATTERN_LENGTH,
  MAX_CUSTOM_RULES,
  validateCustomRuleDraft,
} from "./customRules";
import type { CustomRegexRule } from "../types";

describe("custom regex rules", () => {
  it("matches sample text with a valid custom rule", () => {
    expect(customRuleMatches("ABC-[A-Z]{3}-\\d{2}", "Sygnatura ABC-XYZ-77")).toEqual([
      "ABC-XYZ-77",
    ]);
  });

  it("rejects invalid regex with a message", () => {
    const message = validateCustomRuleDraft(
      { name: "Zła", label: "Zła", pattern: "(" },
      0,
    );

    expect(message).toContain("Niepoprawny regex");
  });

  it("builds payloads only from enabled rules", () => {
    const rules: CustomRegexRule[] = [
      {
        id: "one",
        name: "Sygnatura",
        label: "Sygnatura",
        pattern: "ABC",
        enabled: true,
      },
      {
        id: "two",
        name: "Wyłączona",
        label: "Wyłączona",
        pattern: "XYZ",
        enabled: false,
      },
    ];

    expect(enabledCustomRulePayloads(rules)).toEqual([
      { name: "Sygnatura", label: "Sygnatura", pattern: "ABC" },
    ]);
  });
});

describe("validateCustomRuleDraft", () => {
  const draft = { name: "Sygnatura", label: "SYGNATURA", pattern: "ABC-\\d+" };

  it("rejects once the maximum rule count is reached", () => {
    expect(validateCustomRuleDraft(draft, MAX_CUSTOM_RULES)).toContain("maksymalnie");
  });

  it("requires a name", () => {
    expect(validateCustomRuleDraft({ ...draft, name: "  " }, 0)).toContain("nazwę");
  });

  it("requires a label", () => {
    expect(validateCustomRuleDraft({ ...draft, label: "" }, 0)).toContain("etykietę");
  });

  it("requires a pattern", () => {
    expect(validateCustomRuleDraft({ ...draft, pattern: "" }, 0)).toContain("wzorzec");
  });

  it("rejects a pattern longer than the maximum length", () => {
    const longPattern = "a".repeat(MAX_CUSTOM_RULE_PATTERN_LENGTH + 1);

    expect(validateCustomRuleDraft({ ...draft, pattern: longPattern }, 0)).toContain(
      String(MAX_CUSTOM_RULE_PATTERN_LENGTH),
    );
  });

  it("accepts a complete, valid draft", () => {
    expect(validateCustomRuleDraft(draft, 0)).toBeNull();
  });
});

describe("customRuleMatches", () => {
  it("returns no matches for an empty pattern or empty sample", () => {
    expect(customRuleMatches("", "some text")).toEqual([]);
    expect(customRuleMatches("ABC", "")).toEqual([]);
  });

  it("skips zero-width matches instead of looping forever", () => {
    expect(customRuleMatches("a*", "bbb")).toEqual([]);
  });

  it("caps the number of returned matches at 20", () => {
    const sample = Array.from({ length: 30 }, () => "X").join(" ");

    expect(customRuleMatches("X", sample)).toHaveLength(20);
  });
});

describe("createCustomRule", () => {
  it("trims the draft fields and enables the new rule by default", () => {
    const rule = createCustomRule({ name: " Sygnatura ", label: " SYGNATURA ", pattern: " ABC ",
    });

    expect(rule.name).toBe("Sygnatura");
    expect(rule.label).toBe("SYGNATURA");
    expect(rule.pattern).toBe("ABC");
    expect(rule.enabled).toBe(true);
    expect(rule.id).toMatch(/^custom-rule-/);
  });
});
