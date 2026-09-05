import { describe, expect, it } from "vitest";

import {
  selectionPointsToDocumentRange,
  selectionRangeFromDom,
  type SelectionPoint,
} from "./selectionOffsets";

describe("selectionPointsToDocumentRange", () => {
  it("returns the ordered [start, end] range for a forward selection", () => {
    const anchor: SelectionPoint = { blockStart: 10, offsetInBlock: 2 };
    const focus: SelectionPoint = { blockStart: 10, offsetInBlock: 8 };

    expect(selectionPointsToDocumentRange(anchor, focus)).toEqual({ start: 12, end: 18 });
  });

  it("orders the range correctly for a backward selection (focus before anchor)", () => {
    const anchor: SelectionPoint = { blockStart: 10, offsetInBlock: 8 };
    const focus: SelectionPoint = { blockStart: 10, offsetInBlock: 2 };

    expect(selectionPointsToDocumentRange(anchor, focus)).toEqual({ start: 12, end: 18 });
  });

  it("returns null for a zero-length selection", () => {
    const point: SelectionPoint = { blockStart: 5, offsetInBlock: 3 };

    expect(selectionPointsToDocumentRange(point, point)).toBeNull();
  });
});

function buildDocument() {
  const container = document.createElement("div");
  container.innerHTML =
    '<div data-block-start="10"><span data-segment-start="10">Hello</span> ' +
    '<span data-segment-start="15">World</span></div>';
  document.body.appendChild(container);
  const spans = container.querySelectorAll("span");
  return { container, firstSpan: spans[0], secondSpan: spans[1] };
}

describe("selectionRangeFromDom", () => {
  it("resolves a forward selection spanning two segments into a document range", () => {
    const { container, firstSpan, secondSpan } = buildDocument();
    const range = document.createRange();
    range.setStart(firstSpan.firstChild!, 2);
    range.setEnd(secondSpan.firstChild!, 3);

    expect(selectionRangeFromDom(range)).toEqual({ start: 12, end: 18 });

    container.remove();
  });

  it("returns null when the container has no data-segment-start ancestor", () => {
    const container = document.createElement("div");
    container.innerHTML = "<span>plain text</span>";
    document.body.appendChild(container);
    const span = container.querySelector("span")!;
    const range = document.createRange();
    range.setStart(span.firstChild!, 0);
    range.setEnd(span.firstChild!, 3);

    expect(selectionRangeFromDom(range)).toBeNull();

    container.remove();
  });

  it("returns null when the segment has no data-block-start ancestor", () => {
    const container = document.createElement("div");
    container.innerHTML = '<span data-segment-start="0">orphan</span>';
    document.body.appendChild(container);
    const span = container.querySelector("span")!;
    const range = document.createRange();
    range.setStart(span.firstChild!, 0);
    range.setEnd(span.firstChild!, 3);

    expect(selectionRangeFromDom(range)).toBeNull();

    container.remove();
  });

  it("returns null for a zero-length selection inside a valid segment", () => {
    const { container, firstSpan } = buildDocument();
    const range = document.createRange();
    range.setStart(firstSpan.firstChild!, 1);
    range.setEnd(firstSpan.firstChild!, 1);

    expect(selectionRangeFromDom(range)).toBeNull();

    container.remove();
  });
});
