import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import type { DetectedEntity, ProcessedDocument } from "../types";
import { DocumentView } from "./DocumentView";

afterEach(() => cleanup());

function makeDocument(overrides: Partial<ProcessedDocument> = {}): ProcessedDocument {
  return {
    filename: "pismo.txt",
    format: "txt",
    source: "parsed",
    page_count: 1,
    text: "Jan Kowalski zlozyl pozew.",
    ...overrides,
  };
}

function makeEntity(overrides: Partial<DetectedEntity> = {}): DetectedEntity {
  return {
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
    ...overrides,
  };
}

function renderView(props: Partial<Parameters<typeof DocumentView>[0]> = {}) {
  const handlers = { onEntityClick: vi.fn(), onTextSelection: vi.fn() };
  render(
    <DocumentView
      document={makeDocument()}
      entities={[makeEntity()]}
      hiddenCategories={[]}
      focusEntityId={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("DocumentView", () => {
  it("shows the empty-document note when there is no text", () => {
    renderView({ document: makeDocument({ text: "" }), entities: [] });

    expect(screen.getByText(texts.document.empty)).toBeInTheDocument();
  });

  it("renders the document text with a highlighted entity", () => {
    renderView();

    const mark = screen.getByRole("button", { name: /Jan Kowalski/ });
    expect(mark.tagName).toBe("MARK");
    expect(mark).toHaveClass("cat--person");
    expect(screen.getByText("zlozyl pozew.", { exact: false })).toBeInTheDocument();
  });

  it("hides entities whose category is in hiddenCategories", () => {
    renderView({ hiddenCategories: ["PERSON"] });

    expect(screen.queryByRole("button", { name: /Jan Kowalski/ })).not.toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski", { exact: false })).toBeInTheDocument();
  });

  it("marks failed-validation and rejected entities with their respective classes", () => {
    renderView({
      entities: [makeEntity({ validation: "failed", status: "rejected" })],
    });

    const mark = screen.getByRole("button", { name: /Jan Kowalski/ });
    expect(mark).toHaveClass("highlight--failed");
    expect(mark).toHaveClass("highlight--rejected");
    expect(mark.title).toContain(texts.document.failedValidationTooltip);
  });

  it("calls onEntityClick with the entity and a position when the highlight is clicked", () => {
    const handlers = renderView();

    fireEvent.click(screen.getByRole("button", { name: /Jan Kowalski/ }));

    expect(handlers.onEntityClick).toHaveBeenCalledTimes(1);
    const [entity, position] = handlers.onEntityClick.mock.calls[0];
    expect(entity.id).toBe("person-1");
    expect(position).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  });

  it("calls onEntityClick on Enter and Space key presses", () => {
    const handlers = renderView();
    const mark = screen.getByRole("button", { name: /Jan Kowalski/ });

    fireEvent.keyDown(mark, { key: "Enter" });
    fireEvent.keyDown(mark, { key: " " });

    expect(handlers.onEntityClick).toHaveBeenCalledTimes(2);
  });

  it("does not paginate when the document fits on a single page", () => {
    renderView();

    expect(screen.getByText(`${texts.document.page} 1 / 1`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: texts.document.previousPage })).toBeDisabled();
    expect(screen.getByRole("button", { name: texts.document.nextPage })).toBeDisabled();
  });

  it("paginates across pages once the document has enough blocks", () => {
    const paragraphs = Array.from({ length: 40 }, (_, index) => `Akapit numer ${index}.`);
    const documentText = paragraphs.join("\n\n");
    renderView({ document: makeDocument({ text: documentText }), entities: [] });

    expect(screen.getByText(`${texts.document.page} 1 / 2`)).toBeInTheDocument();
    const nextButton = screen.getByRole("button", { name: texts.document.nextPage });
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);

    expect(screen.getByText(`${texts.document.page} 2 / 2`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: texts.document.nextPage })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: texts.document.previousPage }));

    expect(screen.getByText(`${texts.document.page} 1 / 2`)).toBeInTheDocument();
  });

  it("reports a text selection made within the document as onTextSelection", () => {
    const handlers = renderView({ entities: [] });

    const paragraph = document.querySelector(".document-block")!;
    const textNode = paragraph.querySelector("span")!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    range.getBoundingClientRect = () =>
      ({ left: 10, right: 40, top: 5, bottom: 20, width: 30, height: 15 }) as DOMRect;

    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);

    fireEvent.mouseUp(paragraph.parentElement!);

    expect(handlers.onTextSelection).toHaveBeenCalledTimes(1);
    expect(handlers.onTextSelection.mock.calls[0][0]).toMatchObject({
      range: { start: 0, end: 3 },
      text: "Jan",
    });
  });

  it("ignores a collapsed selection", () => {
    const handlers = renderView({ entities: [] });
    const paragraph = document.querySelector(".document-paper")!;

    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: true,
      rangeCount: 0,
      getRangeAt: () => {
        throw new Error("should not be called");
      },
    } as unknown as Selection);

    fireEvent.mouseUp(paragraph);

    expect(handlers.onTextSelection).not.toHaveBeenCalled();
  });
});
