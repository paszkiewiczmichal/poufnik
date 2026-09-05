import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import type { BatchQueueItem } from "../types";
import { BatchPanel } from "./BatchPanel";

afterEach(() => cleanup());

function makeItem(overrides: Partial<BatchQueueItem> = {}): BatchQueueItem {
  return {
    id: "batch-1",
    file: new File(["x"], "pismo.txt"),
    filename: "pismo.txt",
    size: 2048,
    status: "queued",
    entityCount: null,
    error: null,
    document: null,
    anonymizedText: null,
    replacementMap: null,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof BatchPanel>[0]> = {}) {
  const handlers = {
    onAddFiles: vi.fn(),
    onAddFolder: vi.fn(),
    onRun: vi.fn(),
    onExport: vi.fn(),
    onClear: vi.fn(),
  };
  render(
    <BatchPanel
      items={[]}
      running={false}
      message={null}
      error={null}
      disabled={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("BatchPanel", () => {
  it("shows the empty-queue note when there are no items", () => {
    renderPanel({ items: [] });

    expect(screen.getByText(texts.batch.empty)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows the lead note and item list once items are queued", () => {
    renderPanel({ items: [makeItem()] });

    expect(screen.getByText(texts.batch.lead)).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("pismo.txt")).toBeInTheDocument();
  });

  it("calls onAddFiles / onAddFolder", () => {
    const handlers = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: texts.batch.addFiles }));
    fireEvent.click(screen.getByRole("button", { name: texts.batch.addFolder }));

    expect(handlers.onAddFiles).toHaveBeenCalledTimes(1);
    expect(handlers.onAddFolder).toHaveBeenCalledTimes(1);
  });

  it("disables add buttons when disabled prop is set", () => {
    renderPanel({ disabled: true });

    expect(screen.getByRole("button", { name: texts.batch.addFiles })).toBeDisabled();
    expect(screen.getByRole("button", { name: texts.batch.addFolder })).toBeDisabled();
  });

  it("disables add buttons while running", () => {
    renderPanel({ running: true, items: [makeItem({ status: "processing" })] });

    expect(screen.getByRole("button", { name: texts.batch.addFiles })).toBeDisabled();
    expect(screen.getByRole("button", { name: texts.batch.addFolder })).toBeDisabled();
    expect(screen.getByRole("button", { name: texts.batch.running })).toBeInTheDocument();
  });

  it("shows the entity count for a done item", () => {
    renderPanel({ items: [makeItem({ status: "done", entityCount: 3 })] });

    expect(screen.getByText(texts.batch.entityCount(3))).toBeInTheDocument();
  });

  it("shows the error message for a failed item", () => {
    renderPanel({ items: [makeItem({ status: "error", error: "Plik uszkodzony" })] });

    expect(screen.getByText("Plik uszkodzony")).toBeInTheDocument();
  });

  it("shows the file size for a queued item without an error", () => {
    renderPanel({ items: [makeItem({ status: "queued", size: 4096 })] });

    expect(screen.getByText(texts.batch.fileSize(4096))).toBeInTheDocument();
  });

  it("enables run only when there is a non-done item and not disabled/running", () => {
    renderPanel({ items: [makeItem({ status: "queued" })] });

    expect(screen.getByRole("button", { name: texts.batch.run })).toBeEnabled();
  });

  it("disables run when every item is already done", () => {
    renderPanel({ items: [makeItem({ status: "done", entityCount: 1 })] });

    expect(screen.getByRole("button", { name: texts.batch.run })).toBeDisabled();
  });

  it("enables export only when at least one item is done", () => {
    renderPanel({ items: [makeItem({ status: "done", entityCount: 1 })] });

    expect(screen.getByRole("button", { name: texts.batch.export })).toBeEnabled();
  });

  it("disables export when no item is done yet", () => {
    renderPanel({ items: [makeItem({ status: "queued" })] });

    expect(screen.getByRole("button", { name: texts.batch.export })).toBeDisabled();
  });

  it("calls onRun, onExport, and onClear", () => {
    const handlers = renderPanel({ items: [makeItem({ status: "done", entityCount: 2 })] });

    fireEvent.click(screen.getByRole("button", { name: texts.batch.export }));
    fireEvent.click(screen.getByRole("button", { name: texts.batch.clear }));

    expect(handlers.onExport).toHaveBeenCalledTimes(1);
    expect(handlers.onClear).toHaveBeenCalledTimes(1);
  });

  it("disables clear while running", () => {
    renderPanel({ running: true, items: [makeItem({ status: "processing" })] });

    expect(screen.getByRole("button", { name: texts.batch.clear })).toBeDisabled();
  });

  it("shows the status message and error note when provided", () => {
    renderPanel({ message: "Dodano 2 pliki.", error: "Coś poszło nie tak" });

    expect(screen.getByText("Dodano 2 pliki.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Coś poszło nie tak");
  });
});
