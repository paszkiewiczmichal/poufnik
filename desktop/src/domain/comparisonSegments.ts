import type { OffsetMapEntry } from "../types";

export type ComparisonSide = "original" | "anonymized";

export type ComparisonTextSegment =
  | {
      type: "text";
      start: number;
      end: number;
      text: string;
    }
  | {
      type: "replacement";
      start: number;
      end: number;
      text: string;
      entry: OffsetMapEntry;
    };

export function splitComparisonSegments(
  text: string,
  offsetMap: OffsetMapEntry[],
  side: ComparisonSide,
): ComparisonTextSegment[] {
  const segments: ComparisonTextSegment[] = [];
  const sortedEntries = [...offsetMap].sort((left, right) => {
    const startDiff = startOffset(left, side) - startOffset(right, side);
    return startDiff || endOffset(left, side) - endOffset(right, side);
  });
  let cursor = 0;

  for (const entry of sortedEntries) {
    const start = startOffset(entry, side);
    const end = endOffset(entry, side);
    if (start < cursor || start < 0 || end <= start || start >= text.length) {
      continue;
    }
    const boundedEnd = Math.min(end, text.length);
    if (start > cursor) {
      segments.push({
        type: "text",
        start: cursor,
        end: start,
        text: text.slice(cursor, start),
      });
    }
    segments.push({
      type: "replacement",
      start,
      end: boundedEnd,
      text: text.slice(start, boundedEnd),
      entry,
    });
    cursor = boundedEnd;
  }

  if (cursor < text.length) {
    segments.push({
      type: "text",
      start: cursor,
      end: text.length,
      text: text.slice(cursor),
    });
  }

  return segments;
}

function startOffset(entry: OffsetMapEntry, side: ComparisonSide): number {
  return side === "original" ? entry.original_start : entry.anonymized_start;
}

function endOffset(entry: OffsetMapEntry, side: ComparisonSide): number {
  return side === "original" ? entry.original_end : entry.anonymized_end;
}
