import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import type { CustomRegexRule } from "../types";
import { CustomRulesPanel } from "./CustomRulesPanel";

afterEach(() => cleanup());

function makeRule(overrides: Partial<CustomRegexRule> = {}): CustomRegexRule {
  return {
    id: "rule-1",
    name: "Sygnatura wewnętrzna",
    pattern: "AKT-\\d+",
    label: "SYGNATURA_WEW",
    enabled: true,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof CustomRulesPanel>[0]> = {}) {
  const onChange = vi.fn();
  render(<CustomRulesPanel rules={[]} onChange={onChange} {...props} />);
  return onChange;
}

describe("CustomRulesPanel", () => {
  it("shows the empty note when there are no rules", () => {
    renderPanel({ rules: [] });

    expect(screen.getByText(texts.customRules.empty)).toBeInTheDocument();
  });

  it("lists existing rules with their name, label, and pattern", () => {
    renderPanel({ rules: [makeRule()] });

    expect(screen.getByText("Sygnatura wewnętrzna")).toBeInTheDocument();
    expect(screen.getByText("SYGNATURA_WEW · AKT-\\d+")).toBeInTheDocument();
  });

  it("toggles a rule's enabled flag via its checkbox", () => {
    const onChange = renderPanel({ rules: [makeRule({ enabled: true })] });

    fireEvent.click(screen.getByRole("checkbox", { name: "Sygnatura wewnętrzna" }));

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ enabled: false })]);
  });

  it("deletes a rule when its delete button is clicked", () => {
    const ruleA = makeRule({ id: "rule-a", name: "A" });
    const ruleB = makeRule({ id: "rule-b", name: "B" });
    const onChange = renderPanel({ rules: [ruleA, ruleB] });

    fireEvent.click(screen.getAllByRole("button", { name: texts.customRules.delete })[0]);

    expect(onChange).toHaveBeenCalledWith([ruleB]);
  });

  it("disables the add button and shows a validation message while the draft is incomplete", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: texts.customRules.add })).toBeDisabled();
  });

  it("shows a regex error for an invalid pattern", () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText(texts.customRules.name), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText(texts.customRules.label), { target: { value: "TEST" } });
    fireEvent.change(screen.getByLabelText(texts.customRules.pattern), {
      target: { value: "(unclosed" },
    });

    expect(screen.getByText(/Niepoprawny regex/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: texts.customRules.add })).toBeDisabled();
  });

  it("shows live matches against the sample text once the draft is valid", () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText(texts.customRules.name), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText(texts.customRules.label), { target: { value: "TEST" } });
    fireEvent.change(screen.getByLabelText(texts.customRules.pattern), {
      target: { value: "AKT-\\d+" },
    });
    fireEvent.change(screen.getByLabelText(texts.customRules.sample), {
      target: { value: "Sprawa AKT-123 oraz AKT-456." },
    });

    expect(screen.getByText(texts.customRules.matchCount(2))).toBeInTheDocument();
    expect(screen.getByText("AKT-123, AKT-456")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: texts.customRules.add })).toBeEnabled();
  });

  it("adds the new rule and resets the draft form", () => {
    const onChange = renderPanel();

    fireEvent.change(screen.getByLabelText(texts.customRules.name), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText(texts.customRules.label), { target: { value: "TEST" } });
    fireEvent.change(screen.getByLabelText(texts.customRules.pattern), {
      target: { value: "AKT-\\d+" },
    });
    fireEvent.click(screen.getByRole("button", { name: texts.customRules.add }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: "Test", label: "TEST", pattern: "AKT-\\d+", enabled: true }),
    ]);
    expect(screen.getByLabelText(texts.customRules.name)).toHaveValue("");
  });
});
