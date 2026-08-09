import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";

import { segmentBlock, splitTextIntoBlocks } from "../domain/documentSegments";
import { selectionRangeFromDom } from "../domain/selectionOffsets";
import { texts } from "../i18n";
import { categoryClassName } from "../ui/categoryPresentation";
import type {
  DetectedEntity,
  DocumentTextSelection,
  EntityCategory,
  PopoverPosition,
  ProcessedDocument,
  TextSegment,
} from "../types";

const BLOCKS_PER_PAGE = 32;

interface DocumentViewProps {
  document: ProcessedDocument;
  entities: DetectedEntity[];
  hiddenCategories: EntityCategory[];
  focusEntityId: string | null;
  onEntityClick: (entity: DetectedEntity, position: PopoverPosition) => void;
  onTextSelection: (selection: DocumentTextSelection) => void;
}

export function DocumentView({
  document,
  entities,
  hiddenCategories,
  focusEntityId,
  onEntityClick,
  onTextSelection,
}: DocumentViewProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const textRef = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => splitTextIntoBlocks(document.text), [document.text]);
  // Paginacja bloków zamiast react-window: tekst ma zmienną wysokość, a stały limit
  // renderowanych bloków utrzymuje mały DOM bez pomiarów i bez ryzyka przesunięcia spanów.
  const visibleCategories = useMemo(
    () => new Set(entities.map((entity) => entity.category).filter((category) => !hiddenCategories.includes(category))),
    [entities, hiddenCategories],
  );
  const pageCount = Math.max(1, Math.ceil(blocks.length / BLOCKS_PER_PAGE));
  const boundedPageIndex = Math.min(pageIndex, pageCount - 1);
  const visibleBlocks = blocks.slice(
    boundedPageIndex * BLOCKS_PER_PAGE,
    boundedPageIndex * BLOCKS_PER_PAGE + BLOCKS_PER_PAGE,
  );

  useEffect(() => {
    if (!focusEntityId) {
      return;
    }
    const entity = entities.find((item) => item.id === focusEntityId);
    if (!entity) {
      return;
    }
    const blockIndex = blocks.findIndex(
      (block) => entity.start >= block.start && entity.start < block.end,
    );
    if (blockIndex === -1) {
      return;
    }
    setPageIndex(Math.floor(blockIndex / BLOCKS_PER_PAGE));
    window.setTimeout(() => {
      textRef.current
        ?.querySelector(`[data-entity-id="${focusEntityId}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }, [blocks, entities, focusEntityId]);

  if (!document.text) {
    return <p className="empty-document">{texts.document.empty}</p>;
  }

  return (
    <section className="document-view" aria-label={texts.document.title}>
      <div className="document-view__pager">
        <button
          className="icon-button"
          type="button"
          disabled={boundedPageIndex === 0}
          onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
          title={texts.document.previousPage}
          aria-label={texts.document.previousPage}
        >
          ‹
        </button>
        <span>
          {texts.document.page} {boundedPageIndex + 1} / {pageCount}
        </span>
        <button
          className="icon-button"
          type="button"
          disabled={boundedPageIndex >= pageCount - 1}
          onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
          title={texts.document.nextPage}
          aria-label={texts.document.nextPage}
        >
          ›
        </button>
      </div>

      <div className="document-paper" ref={textRef} onMouseUp={handleMouseUp}>
        {visibleBlocks.map((block) => (
          <p
            className="document-block"
            data-block-start={block.start}
            key={block.id}
          >
            {renderSegments(
              segmentBlock(block, entities, visibleCategories),
              onEntityClick,
            )}
          </p>
        ))}
      </div>
    </section>
  );

  function handleMouseUp() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (
      !textRef.current?.contains(range.commonAncestorContainer) &&
      range.commonAncestorContainer !== textRef.current
    ) {
      return;
    }
    const documentRange = selectionRangeFromDom(range);
    if (!documentRange) {
      return;
    }
    const rect = range.getBoundingClientRect();
    onTextSelection({
      range: documentRange,
      text: document.text.slice(documentRange.start, documentRange.end),
      position: { x: rect.left, y: rect.bottom + 8 },
    });
  }
}

function renderSegments(
  segments: TextSegment[],
  onEntityClick: (entity: DetectedEntity, position: PopoverPosition) => void,
) {
  return segments.map((segment) => {
    if (segment.type === "text") {
      return (
        <span
          data-segment-end={segment.end}
          data-segment-start={segment.start}
          key={`${segment.start}-${segment.end}`}
        >
          {segment.text}
        </span>
      );
    }

    const failed = segment.entity.validation === "failed";
    const rejected = segment.entity.status === "rejected";
    const openPopover = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      onEntityClick(segment.entity, { x: rect.left, y: rect.bottom + 8 });
    };
    return (
      <mark
        className={`highlight ${categoryClassName(segment.entity.category)} ${
          failed ? "highlight--failed" : ""
        } ${rejected ? "highlight--rejected" : ""}`}
        data-entity-id={segment.entity.id}
        data-segment-end={segment.end}
        data-segment-start={segment.start}
        key={`${segment.start}-${segment.end}-${segment.entity.category}`}
        role="button"
        tabIndex={0}
        onClick={(event: MouseEvent<HTMLElement>) => {
          event.stopPropagation();
          openPopover(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPopover(event.currentTarget);
          }
        }}
        aria-label={`${texts.categories[segment.entity.category]}: ${segment.text}`}
        title={
          failed
            ? `${texts.categories[segment.entity.category]} - ${texts.document.failedValidationTooltip}`
            : texts.categories[segment.entity.category]
        }
      >
        {segment.text}
      </mark>
    );
  });
}
