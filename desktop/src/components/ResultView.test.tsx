import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import type { AnonymizationState, DeanonymizationState, PromptState, ReplacementMap } from "../types";
import { ResultView } from "./ResultView";

afterEach(() => cleanup());

const REPLACEMENT_MAP: ReplacementMap = {
  document_fingerprint: "fp",
  entries: [
    { token: "[OSOBA_1]", category: "PERSON", canonical_text: "Jan Kowalski", variants: ["Jan Kowalski"] },
  ],
};

function baseAnonymization(overrides: Partial<AnonymizationState> = {}): AnonymizationState {
  return {
    status: "done",
    error: null,
    anonymizedText: "[OSOBA_1] zlozyl pozew.",
    replacementMap: REPLACEMENT_MAP,
    offsetMap: [],
    ...overrides,
  };
}

function basePrompts(overrides: Partial<PromptState> = {}): PromptState {
  return { status: "ready", error: null, items: [], search: "", selectedId: null, ...overrides };
}

function baseDeanonymization(overrides: Partial<DeanonymizationState> = {}): DeanonymizationState {
  return {
    status: "idle",
    error: null,
    input: "",
    result: null,
    warnings: [],
    replacementMap: null,
    mapSource: null,
    ...overrides,
  };
}

function renderResult(props: Partial<Parameters<typeof ResultView>[0]> = {}) {
  const handlers = {
    onCopyDocument: vi.fn(),
    onSaveMap: vi.fn(),
    onExport: vi.fn(),
    onLoadPrompts: vi.fn(),
    onPromptSearch: vi.fn(),
    onSelectPrompt: vi.fn(),
    onCopyPrompt: vi.fn(),
    onDeanonymizationInput: vi.fn(),
    onDeanonymize: vi.fn(),
    onLoadReplacementMap: vi.fn(),
    onCopyDeanonymizedResult: vi.fn(),
  };
  render(
    <ResultView
      anonymization={baseAnonymization()}
      prompts={basePrompts()}
      deanonymization={baseDeanonymization()}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("ResultView", () => {
  it("shows the anonymized text and replacement badge when a result exists", () => {
    renderResult();

    expect(screen.getByText("[OSOBA_1] zlozyl pozew.")).toBeInTheDocument();
    expect(screen.getByText(texts.generation.replacementBadge(1, 1))).toBeInTheDocument();
  });

  it("hides the badge and disables document actions when there is no result yet", () => {
    renderResult({ anonymization: baseAnonymization({ anonymizedText: null, replacementMap: null }) });

    expect(screen.queryByText(texts.generation.replacementBadge(0, 0))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: texts.generation.copyDocument })).toBeDisabled();
    expect(screen.getByRole("button", { name: texts.generation.exportDocx })).toBeDisabled();
    expect(screen.getByRole("button", { name: texts.generation.exportPdf })).toBeDisabled();
  });

  it("shows the anonymization error alert", () => {
    renderResult({ anonymization: baseAnonymization({ error: "silnik padl" }) });

    expect(screen.getByRole("alert")).toHaveTextContent("silnik padl");
  });

  it("calls onCopyDocument and onExport with the right format", () => {
    const handlers = renderResult();

    fireEvent.click(screen.getByRole("button", { name: texts.generation.copyDocument }));
    fireEvent.click(screen.getByRole("button", { name: texts.generation.exportDocx }));
    fireEvent.click(screen.getByRole("button", { name: texts.generation.exportPdf }));

    expect(handlers.onCopyDocument).toHaveBeenCalledTimes(1);
    expect(handlers.onExport).toHaveBeenCalledWith("docx");
    expect(handlers.onExport).toHaveBeenCalledWith("pdf");
  });

  it("marks the active tab as selected and switches content on click", () => {
    renderResult();

    const textTab = screen.getByRole("tab", { name: texts.generation.tabText });
    const mapTab = screen.getByRole("tab", { name: texts.generation.tabMap });
    expect(textTab).toHaveAttribute("aria-selected", "true");
    expect(mapTab).toHaveAttribute("aria-selected", "false");

    fireEvent.click(mapTab);

    expect(mapTab).toHaveAttribute("aria-selected", "true");
    expect(textTab).toHaveAttribute("aria-selected", "false");
  });

  it("hides the replacement map behind a blur until shown, then supports hiding it again", () => {
    renderResult();

    fireEvent.click(screen.getByRole("tab", { name: texts.generation.tabMap }));

    expect(screen.getByText(texts.generation.mapHiddenNote)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: texts.generation.mapShow })[0]);

    expect(screen.getByText("Jan Kowalski")).toBeInTheDocument();
    expect(screen.queryByText(texts.generation.mapHiddenNote)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: texts.generation.mapHide }));

    expect(screen.getByText(texts.generation.mapHiddenNote)).toBeInTheDocument();
  });

  it("re-hides the map after leaving and returning to the map tab", () => {
    renderResult();

    fireEvent.click(screen.getByRole("tab", { name: texts.generation.tabMap }));
    fireEvent.click(screen.getAllByRole("button", { name: texts.generation.mapShow })[0]);
    expect(screen.getByText("Jan Kowalski")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: texts.generation.tabText }));
    fireEvent.click(screen.getByRole("tab", { name: texts.generation.tabMap }));

    expect(screen.getByText(texts.generation.mapHiddenNote)).toBeInTheDocument();
  });

  it("calls onSaveMap from the map tab", () => {
    const handlers = renderResult();

    fireEvent.click(screen.getByRole("tab", { name: texts.generation.tabMap }));
    fireEvent.click(screen.getByRole("button", { name: texts.generation.saveMap }));

    expect(handlers.onSaveMap).toHaveBeenCalledTimes(1);
  });

  it("renders the restore panel on the restore tab", () => {
    renderResult({ deanonymization: baseDeanonymization({ mapSource: "session" }) });

    fireEvent.click(screen.getByRole("tab", { name: texts.generation.tabRestore }));

    expect(screen.getByText(texts.deanonymization.useCurrentMap)).toBeInTheDocument();
  });
});
