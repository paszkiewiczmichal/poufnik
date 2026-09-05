import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import type { PromptState, PromptTemplate } from "../types";
import { PromptsPanel } from "./PromptsPanel";

afterEach(() => cleanup());

function makePrompt(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: "p1",
    title: "Wezwanie do zapłaty",
    category: "pismo",
    description: "Standardowe wezwanie",
    body: "Szanowni Państwo,\n\n{{DOKUMENT}}\n\nZ poważaniem",
    tags: ["wezwanie", "windykacja"],
    version: "1",
    ...overrides,
  };
}

function makePromptState(overrides: Partial<PromptState> = {}): PromptState {
  return {
    status: "ready",
    error: null,
    items: [makePrompt()],
    search: "",
    selectedId: null,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof PromptsPanel>[0]> = {}) {
  const handlers = {
    onLoad: vi.fn(),
    onSearch: vi.fn(),
    onSelect: vi.fn(),
    onCopyPrompt: vi.fn(),
  };
  render(
    <PromptsPanel prompts={makePromptState()} anonymizedText={null} {...handlers} {...props} />,
  );
  return handlers;
}

describe("PromptsPanel", () => {
  it("triggers onLoad when the prompt list is idle", () => {
    const handlers = renderPanel({ prompts: makePromptState({ status: "idle", items: [] }) });

    expect(handlers.onLoad).toHaveBeenCalledTimes(1);
  });

  it("does not trigger onLoad again once prompts are ready", () => {
    const handlers = renderPanel({ prompts: makePromptState({ status: "ready" }) });

    expect(handlers.onLoad).not.toHaveBeenCalled();
  });

  it("shows the loading note while status is loading", () => {
    renderPanel({ prompts: makePromptState({ status: "loading", items: [] }) });

    expect(screen.getByText(texts.prompts.loading)).toBeInTheDocument();
  });

  it("shows the error note when status is error", () => {
    renderPanel({ prompts: makePromptState({ status: "error", error: "brak połączenia", items: [] }) });

    expect(screen.getByRole("alert")).toHaveTextContent("brak połączenia");
  });

  it("shows the empty note when the list is ready but empty", () => {
    renderPanel({ prompts: makePromptState({ status: "ready", items: [] }) });

    expect(screen.getByText(texts.prompts.empty)).toBeInTheDocument();
  });

  it("filters prompts by title or tag against the search box", () => {
    renderPanel({
      prompts: makePromptState({
        items: [makePrompt({ id: "p1", title: "Wezwanie" }), makePrompt({ id: "p2", title: "Pozew" })],
        search: "pozew",
      }),
    });

    expect(screen.queryByText("Wezwanie")).not.toBeInTheDocument();
    expect(screen.getAllByText("Pozew").length).toBeGreaterThan(0);
  });

  it("calls onSearch when typing in the search box", () => {
    const handlers = renderPanel();

    fireEvent.change(screen.getByLabelText(texts.prompts.search), { target: { value: "wezwanie" } });

    expect(handlers.onSearch).toHaveBeenCalledWith("wezwanie");
  });

  it("selects the first filtered prompt by default and marks it active", () => {
    renderPanel({
      prompts: makePromptState({
        items: [makePrompt({ id: "p1", title: "Wezwanie" }), makePrompt({ id: "p2", title: "Pozew" })],
      }),
    });

    expect(screen.getByRole("heading", { name: "Wezwanie" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Wezwanie/ })).toHaveClass("prompt-item--active");
  });

  it("calls onSelect when a prompt in the list is clicked", () => {
    const handlers = renderPanel({
      prompts: makePromptState({
        items: [makePrompt({ id: "p1", title: "Wezwanie" }), makePrompt({ id: "p2", title: "Pozew" })],
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: /Pozew/ }));

    expect(handlers.onSelect).toHaveBeenCalledWith("p2");
  });

  it("copies the raw prompt body via onCopyPrompt", () => {
    const handlers = renderPanel({
      prompts: makePromptState({ items: [makePrompt({ body: "tresc promptu" })] }),
    });

    fireEvent.click(screen.getByRole("button", { name: texts.prompts.copyPrompt }));

    expect(handlers.onCopyPrompt).toHaveBeenCalledWith("tresc promptu");
  });

  it("disables the copy-with-document button when there is no anonymized text", () => {
    renderPanel({ anonymizedText: null });

    expect(screen.getByRole("button", { name: texts.prompts.copyWithDocument })).toBeDisabled();
  });

  it("renders the prompt merged with the anonymized document when copying with document", () => {
    const handlers = renderPanel({
      anonymizedText: "[OSOBA_1] zlozyl pozew.",
      prompts: makePromptState({
        items: [makePrompt({ body: "Przeanalizuj:\n{{DOKUMENT}}" })],
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: texts.prompts.copyWithDocument }));

    expect(handlers.onCopyPrompt).toHaveBeenCalledWith("Przeanalizuj:\n[OSOBA_1] zlozyl pozew.");
  });
});
