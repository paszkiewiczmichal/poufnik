import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deriveEntityGroups } from "../domain/entities";
import { texts } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import type {
  AnonymizationState,
  DeanonymizationState,
  DetectedEntity,
  PromptState,
  ReplacementMap,
} from "../types";
import { DocumentWorkspace, type WorkspaceView } from "./DocumentWorkspace";

describe("DocumentWorkspace Early Bird features", () => {
  afterEach(() => {
    cleanup();
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  it("gates comparison for Basic users", () => {
    renderWorkspace("basic", { view: "compare" });

    expect(screen.getByTestId("tier-gate")).toHaveTextContent(texts.compare.title);
    expect(screen.queryByText(texts.compare.original)).not.toBeInTheDocument();
  });

  it("shows comparison for Early Bird users", () => {
    renderWorkspace("early_bird", { view: "compare" });

    expect(screen.getByText(texts.compare.original)).toBeInTheDocument();
    expect(screen.getByText(texts.compare.anonymized)).toBeInTheDocument();
    expect(screen.getAllByTitle("[OSOBA_1]").length).toBeGreaterThan(0);
  });
});

describe("DocumentWorkspace public institutions", () => {
  afterEach(() => {
    cleanup();
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  it("shows public institution highlights only after expanding the informational section", () => {
    const documentText =
      "Jan Kowalski złożył pismo w Sądzie Okręgowym w Gdańsku.";
    const { container } = renderWorkspace("early_bird", {
      anonymization: idleAnonymization(),
      documentText,
      entities: publicInstitutionEntities(documentText),
    });

    expect(screen.getByText(texts.entities.publicInstitutionsTitle)).toBeInTheDocument();
    expect(container.querySelector('[data-entity-id="institution-1"]')).toBeNull();

    const summary = screen.getByText(texts.entities.publicInstitutionsTitle).closest("summary");
    expect(summary).not.toBeNull();
    const details = summary?.closest("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle", { bubbles: true }));

    const highlight = container.querySelector('[data-entity-id="institution-1"]');
    expect(highlight).not.toBeNull();
    expect(highlight).toHaveClass("highlight--public-institution");
    expect(highlight).toHaveClass("highlight--rejected");
    expect(screen.getByText(texts.entities.restorePublicInstitutions)).toBeInTheDocument();
  });
});

interface RenderWorkspaceOptions {
  anonymization?: AnonymizationState;
  documentText?: string;
  entities?: DetectedEntity[];
  view?: WorkspaceView;
}

function renderWorkspace(tier: "basic" | "early_bird", options: RenderWorkspaceOptions = {}) {
  const documentText = options.documentText ?? "Jan Kowalski ma PESEL 44051401359.";
  const workspaceEntities = options.entities ?? entities();
  const anonymization: AnonymizationState = options.anonymization ?? {
    status: "done",
    error: null,
    anonymizedText: "[OSOBA_1] ma PESEL [PESEL_1].",
    replacementMap: replacementMap(),
    offsetMap: [
      {
        original_start: 0,
        original_end: 12,
        anonymized_start: 0,
        anonymized_end: 9,
        token: "[OSOBA_1]",
        category: "PERSON",
      },
      {
        original_start: 22,
        original_end: 33,
        anonymized_start: 19,
        anonymized_end: 28,
        token: "[PESEL_1]",
        category: "PESEL",
      },
    ],
  };

  return render(
    <DocumentWorkspace
      document={{
        filename: "umowa.txt",
        format: "txt",
        source: "parsed",
        page_count: 1,
        text: documentText,
      }}
      entities={workspaceEntities}
      entityGroups={deriveEntityGroups(workspaceEntities)}
      hiddenCategories={[]}
      anonymization={anonymization}
      prompts={promptState()}
      deanonymization={deanonymizationState()}
      processingStatus="idle"
      processingError={null}
      tier={tier}
      view={options.view ?? "document"}
      onViewChange={vi.fn()}
      onToggleCategory={vi.fn()}
      onRedetect={vi.fn()}
      onNewDocument={vi.fn()}
      onAnonymize={vi.fn()}
      onCopyDocument={vi.fn()}
      onSaveMap={vi.fn()}
      onExport={vi.fn()}
      onLoadPrompts={vi.fn()}
      onPromptSearch={vi.fn()}
      onSelectPrompt={vi.fn()}
      onCopyPrompt={vi.fn()}
      onDeanonymizationInput={vi.fn()}
      onDeanonymize={vi.fn()}
      onLoadReplacementMap={vi.fn()}
      onCopyDeanonymizedResult={vi.fn()}
      onRegister={vi.fn()}
      canRedetect
    />,
  );
}

function entities(): DetectedEntity[] {
  return [
    {
      id: "person-1",
      category: "PERSON",
      start: 0,
      end: 12,
      text: "Jan Kowalski",
      confidence: 0.95,
      source: "ner",
      validation: "not_applicable",
      status: "accepted",
      entity_group_id: "person-1",
      canonical_text: "Jan Kowalski",
    },
  ];
}

function publicInstitutionEntities(text: string): DetectedEntity[] {
  const person = "Jan Kowalski";
  const institution = "Sądzie Okręgowym w Gdańsku";
  const personStart = text.indexOf(person);
  const institutionStart = text.indexOf(institution);
  return [
    {
      id: "person-1",
      category: "PERSON",
      start: personStart,
      end: personStart + person.length,
      text: person,
      confidence: 0.95,
      source: "dictionary",
      validation: "not_applicable",
      status: "accepted",
      entity_group_id: "person-1",
      canonical_text: person,
    },
    {
      id: "institution-1",
      category: "PUBLIC_INSTITUTION",
      start: institutionStart,
      end: institutionStart + institution.length,
      text: institution,
      confidence: 0.9,
      source: "regex",
      validation: "not_applicable",
      status: "rejected",
      entity_group_id: "public-institution-1",
      canonical_text: institution,
    },
  ];
}

function idleAnonymization(): AnonymizationState {
  return {
    status: "idle",
    error: null,
    anonymizedText: null,
    replacementMap: null,
    offsetMap: [],
  };
}

function replacementMap(): ReplacementMap {
  return {
    entries: [
      {
        token: "[OSOBA_1]",
        category: "PERSON",
        canonical_text: "Jan Kowalski",
        variants: ["Jan Kowalski"],
      },
    ],
    document_fingerprint: "abc",
  };
}

function promptState(): PromptState {
  return {
    status: "idle",
    error: null,
    items: [],
    search: "",
    selectedId: null,
  };
}

function deanonymizationState(): DeanonymizationState {
  return {
    status: "idle",
    error: null,
    input: "",
    result: null,
    warnings: [],
    replacementMap: null,
  };
}
