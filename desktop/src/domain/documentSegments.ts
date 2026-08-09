import type {
  DetectedEntity,
  DocumentBlock,
  EntityCategory,
  ExportBlock,
  TextSegment,
} from "../types";

const MAX_BLOCK_CHARS = 5000;

export function splitTextIntoBlocks(text: string): DocumentBlock[] {
  if (!text) {
    return [];
  }

  const blocks: DocumentBlock[] = [];
  let blockStart = 0;
  let page = 1;
  const separatorPattern = /(\f|\n{2,})/g;
  let match: RegExpExecArray | null;

  while ((match = separatorPattern.exec(text)) !== null) {
    const separator = match[0];
    const end = match.index + separator.length;
    pushChunkedBlocks(blocks, text, blockStart, end, page);
    if (separator.includes("\f")) {
      page += countOccurrences(separator, "\f");
    }
    blockStart = end;
  }

  pushChunkedBlocks(blocks, text, blockStart, text.length, page);
  return blocks;
}

export function segmentBlock(
  block: DocumentBlock,
  entities: DetectedEntity[],
  visibleCategories: ReadonlySet<EntityCategory>,
): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = block.start;
  const relevantEntities = entities
    .filter(
      (entity) =>
        visibleCategories.has(entity.category) &&
        entity.end > block.start &&
        entity.start < block.end,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);

  for (const entity of relevantEntities) {
    const start = Math.max(entity.start, block.start);
    const end = Math.min(entity.end, block.end);
    if (end <= start) {
      continue;
    }
    if (start > cursor) {
      segments.push({
        type: "text",
        start: cursor,
        end: start,
        text: block.text.slice(cursor - block.start, start - block.start),
      });
    }
    segments.push({
      type: "entity",
      start,
      end,
      text: block.text.slice(start - block.start, end - block.start),
      entity,
    });
    cursor = end;
  }

  if (cursor < block.end) {
    segments.push({
      type: "text",
      start: cursor,
      end: block.end,
      text: block.text.slice(cursor - block.start),
    });
  }

  return segments;
}

export function blocksForExport(text: string): ExportBlock[] {
  return splitTextIntoBlocks(text).map((block) => ({
    start: block.start,
    end: block.end,
    kind: "paragraph",
    page: block.page,
  }));
}

function pushChunkedBlocks(
  blocks: DocumentBlock[],
  text: string,
  start: number,
  end: number,
  page: number,
): void {
  if (end <= start) {
    return;
  }

  let cursor = start;
  while (cursor < end) {
    const next = Math.min(cursor + MAX_BLOCK_CHARS, end);
    blocks.push({
      id: `block-${blocks.length}`,
      start: cursor,
      end: next,
      text: text.slice(cursor, next),
      page,
    });
    cursor = next;
  }
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
