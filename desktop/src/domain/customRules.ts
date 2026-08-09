import type { CustomRegexRule, CustomRegexRulePayload } from "../types";

export const MAX_CUSTOM_RULES = 25;
export const MAX_CUSTOM_RULE_PATTERN_LENGTH = 256;

export interface CustomRuleDraft {
  name: string;
  pattern: string;
  label: string;
}

export function validateCustomRuleDraft(
  draft: CustomRuleDraft,
  existingCount: number,
): string | null {
  if (existingCount >= MAX_CUSTOM_RULES) {
    return `Można zapisać maksymalnie ${MAX_CUSTOM_RULES} reguł.`;
  }
  if (!draft.name.trim()) {
    return "Podaj nazwę reguły.";
  }
  if (!draft.label.trim()) {
    return "Podaj etykietę kategorii CUSTOM.";
  }
  if (!draft.pattern.trim()) {
    return "Podaj wzorzec regex.";
  }
  if (draft.pattern.length > MAX_CUSTOM_RULE_PATTERN_LENGTH) {
    return `Wzorzec może mieć maksymalnie ${MAX_CUSTOM_RULE_PATTERN_LENGTH} znaków.`;
  }
  try {
    compileCustomRulePattern(draft.pattern);
  } catch (error) {
    return `Niepoprawny regex: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}

export function customRuleMatches(pattern: string, sampleText: string): string[] {
  if (!pattern || !sampleText) {
    return [];
  }
  const regex = compileCustomRulePattern(pattern);
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sampleText)) !== null && matches.length < 20) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    matches.push(match[0]);
  }
  return matches;
}

export function enabledCustomRulePayloads(
  rules: CustomRegexRule[],
): CustomRegexRulePayload[] {
  return rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({
      name: rule.name,
      pattern: rule.pattern,
      label: rule.label,
    }));
}

export function createCustomRule(draft: CustomRuleDraft): CustomRegexRule {
  return {
    id: `custom-rule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: draft.name.trim(),
    pattern: draft.pattern.trim(),
    label: draft.label.trim(),
    enabled: true,
  };
}

function compileCustomRulePattern(pattern: string): RegExp {
  return new RegExp(pattern, "gu");
}
