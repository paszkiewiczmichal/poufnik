import type { ReplacementMap } from "../types";

export type RestoredTextSegment =
  | { type: "text"; text: string; start: number; end: number }
  | { type: "restored"; text: string; start: number; end: number; token: string };

const TOKEN_PATTERN = /\[[A-ZĄĆĘŁŃÓŚŹŻ]+(?:_[A-ZĄĆĘŁŃÓŚŹŻ]+)*_\d+\]/g;

export function restoredSegmentsFromTokenizedText(
  tokenizedText: string,
  restoredText: string,
  replacementMap: ReplacementMap,
): RestoredTextSegment[] {
  const entries = new Map(replacementMap.entries.map((entry) => [entry.token, entry]));
  const segments: RestoredTextSegment[] = [];
  let sourceCursor = 0;
  let outputCursor = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_PATTERN.exec(tokenizedText)) !== null) {
    const token = match[0];
    const before = tokenizedText.slice(sourceCursor, match.index);
    if (before) {
      pushTextSegment(segments, restoredText, outputCursor, outputCursor + before.length);
      outputCursor += before.length;
    }

    const entry = entries.get(token);
    if (entry) {
      const start = outputCursor;
      const end = start + entry.canonical_text.length;
      segments.push({
        type: "restored",
        text: restoredText.slice(start, end),
        start,
        end,
        token,
      });
      outputCursor = end;
    } else {
      pushTextSegment(segments, restoredText, outputCursor, outputCursor + token.length);
      outputCursor += token.length;
    }
    sourceCursor = match.index + token.length;
  }

  if (outputCursor < restoredText.length) {
    pushTextSegment(segments, restoredText, outputCursor, restoredText.length);
  }

  return segments;
}

function pushTextSegment(
  segments: RestoredTextSegment[],
  restoredText: string,
  start: number,
  end: number,
): void {
  if (end <= start) {
    return;
  }
  segments.push({
    type: "text",
    text: restoredText.slice(start, end),
    start,
    end,
  });
}
