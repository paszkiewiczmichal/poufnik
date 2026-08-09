import { useMemo, useState } from "react";

import {
  createCustomRule,
  customRuleMatches,
  validateCustomRuleDraft,
  type CustomRuleDraft,
} from "../domain/customRules";
import { texts } from "../i18n";
import type { CustomRegexRule } from "../types";

interface CustomRulesPanelProps {
  rules: CustomRegexRule[];
  onChange: (rules: CustomRegexRule[]) => void;
}

const initialDraft: CustomRuleDraft = {
  name: "",
  pattern: "",
  label: "",
};

export function CustomRulesPanel({ rules, onChange }: CustomRulesPanelProps) {
  const [draft, setDraft] = useState<CustomRuleDraft>(initialDraft);
  const [sampleText, setSampleText] = useState("");
  const validationMessage = useMemo(
    () => validateCustomRuleDraft(draft, rules.length),
    [draft, rules.length],
  );
  const matches = useMemo(() => {
    if (validationMessage || !sampleText) {
      return [];
    }
    return customRuleMatches(draft.pattern, sampleText);
  }, [draft.pattern, sampleText, validationMessage]);

  return (
    <section className="custom-rules-panel">
      <div className="custom-rules-list">
        {rules.length === 0 ? <p className="empty-note">{texts.customRules.empty}</p> : null}
        {rules.map((rule) => (
          <article className="custom-rule-item" key={rule.id}>
            <label className="checkbox-row">
              <input
                checked={rule.enabled}
                type="checkbox"
                onChange={(event) =>
                  updateRule(rule.id, { enabled: event.currentTarget.checked })
                }
                aria-label={rule.name}
              />
            </label>
            <div className="custom-rule-item__body">
              <strong>{rule.name}</strong>
              <code>
                {rule.label} · {rule.pattern}
              </code>
            </div>
            <button
              className="ghost-button ghost-button--compact"
              type="button"
              onClick={() => onChange(rules.filter((item) => item.id !== rule.id))}
            >
              {texts.customRules.delete}
            </button>
          </article>
        ))}
      </div>

      <div className="custom-rule-form">
        <label className="field">
          {texts.customRules.name}
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
          />
        </label>
        <label className="field">
          {texts.customRules.label}
          <input
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.currentTarget.value })}
          />
        </label>
        <label className="field">
          {texts.customRules.pattern}
          <input
            value={draft.pattern}
            onChange={(event) => setDraft({ ...draft, pattern: event.currentTarget.value })}
          />
        </label>
        <label className="field custom-rule-form__wide">
          {texts.customRules.sample}
          <textarea
            value={sampleText}
            onChange={(event) => setSampleText(event.currentTarget.value)}
          />
        </label>
        <div className="custom-rule-form__wide custom-rule-test">
          <span className="tag-row">
            <span>CUSTOM</span>
            <span>{texts.customRules.matchCount(matches.length)}</span>
          </span>
          {matches.length > 0 ? <p>{matches.slice(0, 5).join(", ")}</p> : null}
          {validationMessage ? <p className="error-note">{validationMessage}</p> : null}
        </div>
        <div className="custom-rule-form__actions">
          <button
            className="primary-button"
            disabled={Boolean(validationMessage)}
            type="button"
            onClick={() => {
              onChange([...rules, createCustomRule(draft)]);
              setDraft(initialDraft);
              setSampleText("");
            }}
          >
            {texts.customRules.add}
          </button>
        </div>
      </div>
    </section>
  );

  function updateRule(id: string, patch: Partial<CustomRegexRule>): void {
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  }
}
