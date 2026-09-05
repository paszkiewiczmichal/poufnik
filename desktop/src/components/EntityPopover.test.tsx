import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import type { DetectedEntity, EntityGroupSummary } from "../types";
import { EntityPopover } from "./EntityPopover";

afterEach(() => cleanup());

function makeEntity(overrides: Partial<DetectedEntity> = {}): DetectedEntity {
  return {
    id: "e1",
    start: 0,
    end: 12,
    text: "Jan Kowalski",
    category: "PERSON",
    confidence: 0.9,
    source: "ner",
    status: "accepted",
    validation: "not_applicable",
    entity_group_id: "value:PERSON:Jan Kowalski",
    canonical_text: "Jan Kowalski",
    ...overrides,
  };
}

function makeGroup(overrides: Partial<EntityGroupSummary> = {}): EntityGroupSummary {
  return {
    id: "value:PERSON:Jan Kowalski",
    category: "PERSON",
    label: "Jan Kowalski",
    canonicalText: "Jan Kowalski",
    count: 1,
    acceptedCount: 1,
    rejectedCount: 0,
    token: "[OSOBA_1]",
    firstEntityId: "e1",
    firstStart: 0,
    ...overrides,
  };
}

function renderPopover(props: Partial<Parameters<typeof EntityPopover>[0]> = {}) {
  const handlers = {
    onStatusChange: vi.fn(),
    onCategoryChange: vi.fn(),
    onAssignGroup: vi.fn(),
    onCreateGroup: vi.fn(),
    onMergeGroups: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <EntityPopover
      entity={makeEntity()}
      groups={[makeGroup()]}
      position={{ x: 10, y: 20 }}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("EntityPopover", () => {
  it("renders the entity text, category, and group occurrence count", () => {
    renderPopover({ groups: [makeGroup({ count: 3 })] });

    expect(screen.getByText("Jan Kowalski")).toBeInTheDocument();
    expect(screen.getAllByText("[OSOBA_1]", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText(texts.entities.occurrences(3), { exact: false })).toBeInTheDocument();
  });

  it("shows the failed-validation note when the entity failed validation", () => {
    renderPopover({ entity: makeEntity({ validation: "failed" }) });

    expect(screen.getByText(texts.document.failedValidationTooltip)).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const handlers = renderPopover();

    fireEvent.click(screen.getByRole("button", { name: texts.corrections.close }));

    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    const handlers = renderPopover();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("calls onCategoryChange when a new category is selected", () => {
    const handlers = renderPopover();

    fireEvent.change(screen.getByLabelText(texts.corrections.category), {
      target: { value: "ADDRESS" },
    });

    expect(handlers.onCategoryChange).toHaveBeenCalledWith("e1", "ADDRESS");
  });

  it("calls onAssignGroup when a different group is selected", () => {
    const otherGroup = makeGroup({ id: "value:PERSON:Anna Nowak", canonicalText: "Anna Nowak" });
    const handlers = renderPopover({ groups: [makeGroup(), otherGroup] });

    fireEvent.change(screen.getByLabelText(texts.corrections.group), {
      target: { value: otherGroup.id },
    });

    expect(handlers.onAssignGroup).toHaveBeenCalledWith("e1", otherGroup.id);
  });

  it("calls onCreateGroup when the create-group button is clicked", () => {
    const handlers = renderPopover();

    fireEvent.click(screen.getByRole("button", { name: texts.corrections.createGroup }));

    expect(handlers.onCreateGroup).toHaveBeenCalledWith("e1");
  });

  it("does not show the merge controls when there is only one group for the category", () => {
    renderPopover({ groups: [makeGroup()] });

    expect(screen.queryByText(texts.corrections.merge)).not.toBeInTheDocument();
  });

  it("merges into the selected group and resets the merge selection afterwards", () => {
    const otherGroup = makeGroup({ id: "value:PERSON:Anna Nowak", canonicalText: "Anna Nowak" });
    const handlers = renderPopover({ groups: [makeGroup(), otherGroup] });

    const mergeButton = screen.getByRole("button", { name: texts.corrections.merge });
    expect(mergeButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(texts.corrections.mergeGroup), {
      target: { value: otherGroup.id },
    });
    expect(mergeButton).toBeEnabled();

    fireEvent.click(mergeButton);

    expect(handlers.onMergeGroups).toHaveBeenCalledWith("value:PERSON:Jan Kowalski", otherGroup.id);
  });

  it("toggles between reject and restore based on the entity's status", () => {
    const handlers = renderPopover({ entity: makeEntity({ status: "accepted" }) });

    fireEvent.click(screen.getByRole("button", { name: texts.corrections.reject }));

    expect(handlers.onStatusChange).toHaveBeenCalledWith("e1", "rejected");
  });

  it("shows the restore label when the entity is already rejected", () => {
    const handlers = renderPopover({ entity: makeEntity({ status: "rejected" }) });

    fireEvent.click(screen.getByRole("button", { name: texts.corrections.restore }));

    expect(handlers.onStatusChange).toHaveBeenCalledWith("e1", "accepted");
  });

  it("calls onClose from the done button", () => {
    const handlers = renderPopover();

    fireEvent.click(screen.getByRole("button", { name: texts.corrections.done }));

    expect(handlers.onClose).toHaveBeenCalled();
  });
});
