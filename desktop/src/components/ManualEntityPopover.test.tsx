import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import type { DocumentTextSelection, EntityGroupSummary } from "../types";
import { ManualEntityPopover } from "./ManualEntityPopover";

afterEach(() => cleanup());

function makeSelection(overrides: Partial<DocumentTextSelection> = {}): DocumentTextSelection {
  return {
    range: { start: 0, end: 10 },
    text: "Kancelaria XYZ",
    position: { x: 5, y: 15 },
    ...overrides,
  };
}

function makeGroup(overrides: Partial<EntityGroupSummary> = {}): EntityGroupSummary {
  return {
    id: "value:COMPANY:Kancelaria XYZ",
    category: "COMPANY",
    label: "Kancelaria XYZ",
    canonicalText: "Kancelaria XYZ",
    count: 1,
    acceptedCount: 1,
    rejectedCount: 0,
    token: "[FIRMA_1]",
    firstEntityId: "e1",
    firstStart: 0,
    ...overrides,
  };
}

function renderPopover(props: Partial<Parameters<typeof ManualEntityPopover>[0]> = {}) {
  const handlers = { onAdd: vi.fn(), onClose: vi.fn() };
  render(
    <ManualEntityPopover selection={makeSelection()} groups={[makeGroup()]} {...handlers} {...props} />,
  );
  return handlers;
}

describe("ManualEntityPopover", () => {
  it("shows the selected snippet text", () => {
    renderPopover({ selection: makeSelection({ text: "Kancelaria XYZ" }) });

    expect(screen.getByText("Kancelaria XYZ")).toBeInTheDocument();
  });

  it("calls onClose from the close icon and Escape key", () => {
    const handlers = renderPopover();

    fireEvent.click(screen.getByRole("button", { name: texts.corrections.close }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(handlers.onClose).toHaveBeenCalledTimes(2);
  });

  it("calls onClose from the cancel button", () => {
    const handlers = renderPopover();

    fireEvent.click(screen.getByRole("button", { name: texts.corrections.cancel }));

    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("defaults to CUSTOM category and no group", () => {
    const handlers = renderPopover();

    fireEvent.click(screen.getByRole("button", { name: texts.corrections.add }));

    expect(handlers.onAdd).toHaveBeenCalledWith("CUSTOM", null);
  });

  it("resets the selected group whenever the category changes", () => {
    const handlers = renderPopover({ groups: [makeGroup()] });

    fireEvent.change(screen.getByLabelText(texts.corrections.category), {
      target: { value: "COMPANY" },
    });
    fireEvent.change(screen.getByLabelText(texts.corrections.group), {
      target: { value: "value:COMPANY:Kancelaria XYZ" },
    });
    fireEvent.click(screen.getByRole("button", { name: texts.corrections.add }));

    expect(handlers.onAdd).toHaveBeenCalledWith("COMPANY", "value:COMPANY:Kancelaria XYZ");

    handlers.onAdd.mockClear();
    fireEvent.change(screen.getByLabelText(texts.corrections.category), {
      target: { value: "PERSON" },
    });
    fireEvent.click(screen.getByRole("button", { name: texts.corrections.add }));

    expect(handlers.onAdd).toHaveBeenCalledWith("PERSON", null);
  });

  it("only offers groups matching the currently selected category", () => {
    renderPopover({
      groups: [
        makeGroup({ id: "g-company", category: "COMPANY", canonicalText: "Kancelaria XYZ" }),
        makeGroup({ id: "g-person", category: "PERSON", canonicalText: "Jan Kowalski" }),
      ],
    });

    fireEvent.change(screen.getByLabelText(texts.corrections.category), {
      target: { value: "COMPANY" },
    });

    expect(screen.queryByText("Jan Kowalski", { exact: false })).not.toBeInTheDocument();
  });
});
