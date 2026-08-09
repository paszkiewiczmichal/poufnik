import type { DocumentSelectionRange } from "../types";

export interface SelectionPoint {
  blockStart: number;
  offsetInBlock: number;
}

export function selectionPointsToDocumentRange(
  anchor: SelectionPoint,
  focus: SelectionPoint,
): DocumentSelectionRange | null {
  const anchorOffset = anchor.blockStart + anchor.offsetInBlock;
  const focusOffset = focus.blockStart + focus.offsetInBlock;
  const start = Math.min(anchorOffset, focusOffset);
  const end = Math.max(anchorOffset, focusOffset);
  if (end <= start) {
    return null;
  }
  return { start, end };
}

export function selectionRangeFromDom(range: Range): DocumentSelectionRange | null {
  const start = selectionPointFromDom(range.startContainer, range.startOffset);
  const end = selectionPointFromDom(range.endContainer, range.endOffset);
  if (!start || !end) {
    return null;
  }
  return selectionPointsToDocumentRange(start, end);
}

function selectionPointFromDom(node: Node, offset: number): SelectionPoint | null {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!(element instanceof Element)) {
    return null;
  }

  const segment = element.closest<HTMLElement>("[data-segment-start]");
  if (!segment) {
    return null;
  }

  const segmentStart = Number(segment.dataset.segmentStart);
  const blockStart = Number(segment.closest<HTMLElement>("[data-block-start]")?.dataset.blockStart);
  if (!Number.isFinite(segmentStart) || !Number.isFinite(blockStart)) {
    return null;
  }

  return {
    blockStart,
    offsetInBlock: segmentStart - blockStart + offset,
  };
}
