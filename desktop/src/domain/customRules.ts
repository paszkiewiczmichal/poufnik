import type { CustomRegexRule, CustomRegexRulePayload, EntityCategory } from "../types";
import { tokenPrefix } from "./entities";
import { manualPhrasePattern } from "./manualPattern";

export const MAX_CUSTOM_RULES = 100;
export const MAX_CUSTOM_RULE_PATTERN_LENGTH = 512;

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
    return "Podaj oznaczenie w tekście, np. SYGNATURA.";
  }
  if (!draft.pattern.trim()) {
    return "Podaj wzorzec.";
  }
  if (draft.pattern.length > MAX_CUSTOM_RULE_PATTERN_LENGTH) {
    return `Wzorzec może mieć maksymalnie ${MAX_CUSTOM_RULE_PATTERN_LENGTH} znaków.`;
  }
  try {
    compileCustomRulePattern(draft.pattern);
  } catch (error) {
    return `Niepoprawny wzorzec: ${error instanceof Error ? error.message : String(error)}`;
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
      ...(rule.category ? { category: rule.category } : {}),
    }));
}

export type ManualRuleOutcome =
  | { status: "added"; rules: CustomRegexRule[]; rule: CustomRegexRule }
  | { status: "exists" }
  | { status: "limit" }
  | { status: "too_long" };

/**
 * Saves a phrase marked by hand as a custom rule, so every next document has it marked
 * too, in its case forms. Falls back to the exact form when the inflected pattern is too
 * long for the engine.
 */
export function addManualRule(
  rules: CustomRegexRule[],
  text: string,
  category: EntityCategory,
): ManualRuleOutcome {
  const name = text.trim().replace(/\s+/g, " ");
  const pattern = [manualPhrasePattern(name), manualPhrasePattern(name, false)].find(
    (candidate) => candidate.length <= MAX_CUSTOM_RULE_PATTERN_LENGTH,
  );
  if (!pattern) {
    return { status: "too_long" };
  }
  if (rules.some((rule) => rule.pattern === pattern)) {
    return { status: "exists" };
  }
  if (rules.length >= MAX_CUSTOM_RULES) {
    return { status: "limit" };
  }
  const rule = {
    ...createCustomRule({ name, pattern, label: tokenPrefix(category) }),
    category,
  };
  return { status: "added", rules: [...rules, rule], rule };
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
