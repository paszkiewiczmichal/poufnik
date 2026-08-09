import type { CustomRegexRule } from "../types";

const CUSTOM_RULES_KEY = "anonymizer.customRegexRules.v1";

export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadCustomRegexRules(
  storage: LocalStorageLike = window.localStorage,
): CustomRegexRule[] {
  const raw = storage.getItem(CUSTOM_RULES_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as CustomRegexRule[];
    return Array.isArray(parsed) ? parsed.filter(isCustomRegexRule) : [];
  } catch {
    return [];
  }
}

export function saveCustomRegexRules(
  rules: CustomRegexRule[],
  storage: LocalStorageLike = window.localStorage,
): void {
  storage.setItem(CUSTOM_RULES_KEY, JSON.stringify(rules));
}

function isCustomRegexRule(value: unknown): value is CustomRegexRule {
  if (!value || typeof value !== "object") {
    return false;
  }
  const rule = value as Partial<CustomRegexRule>;
  return (
    typeof rule.id === "string" &&
    typeof rule.name === "string" &&
    typeof rule.pattern === "string" &&
    typeof rule.label === "string" &&
    typeof rule.enabled === "boolean"
  );
}
