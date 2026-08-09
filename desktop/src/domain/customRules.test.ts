import { describe, expect, it } from "vitest";

import {
  customRuleMatches,
  enabledCustomRulePayloads,
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
