import { useMemo, useRef } from "react";
import type { RefObject } from "react";

import { splitComparisonSegments } from "../domain/comparisonSegments";
import { texts } from "../i18n";
import { categoryClassName } from "../ui/categoryPresentation";
import type { EntityCategory, OffsetMapEntry } from "../types";

interface ComparisonViewProps {
  originalText: string;
  anonymizedText: string;
  offsetMap: OffsetMapEntry[];
}

export function ComparisonView({
  originalText,
  anonymizedText,
  offsetMap,
}: ComparisonViewProps) {
  const originalRef = useRef<HTMLDivElement>(null);
  const anonymizedRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const originalSegments = useMemo(
    () => splitComparisonSegments(originalText, offsetMap, "original"),
    [offsetMap, originalText],
  );
  const anonymizedSegments = useMemo(
    () => splitComparisonSegments(anonymizedText, offsetMap, "anonymized"),
    [anonymizedText, offsetMap],
  );

  return (
    <section className="comparison-view" aria-labelledby="comparison-title">
      <div className="comparison-view__header">
        <h2 id="comparison-title">{texts.compare.title}</h2>
        <p>{texts.compare.lead}</p>
      </div>
      <div className="comparison-grid">
        <ComparisonPane
          label={texts.compare.original}
          onScroll={(source) => syncScroll(source, anonymizedRef.current)}
          paneRef={originalRef}
          segments={originalSegments}
        />
        <ComparisonPane
          anonymized
          label={texts.compare.anonymized}
          onScroll={(source) => syncScroll(source, originalRef.current)}
          paneRef={anonymizedRef}
          segments={anonymizedSegments}
        />
      </div>
    </section>
  );

  function syncScroll(source: HTMLDivElement, target: HTMLDivElement | null): void {
    if (!target || syncingRef.current) {
      return;
    }
    syncingRef.current = true;
    syncAxis(source, target, "scrollTop", "scrollHeight", "clientHeight");
    syncAxis(source, target, "scrollLeft", "scrollWidth", "clientWidth");
    window.requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }
}

interface ComparisonPaneProps {
  label: string;
  anonymized?: boolean;
  paneRef: RefObject<HTMLDivElement | null>;
  segments: ReturnType<typeof splitComparisonSegments>;
  onScroll: (source: HTMLDivElement) => void;
}

function ComparisonPane({ label, anonymized, paneRef, segments, onScroll }: ComparisonPaneProps) {
  return (
    <section
      className={`comparison-pane ${anonymized ? "comparison-pane--anonymized" : ""}`}
      aria-label={label}
    >
      <div className="comparison-pane__header">{label}</div>
      <div
        className="comparison-pane__body"
        onScroll={(event) => onScroll(event.currentTarget)}
        ref={paneRef}
      >
        <pre className="comparison-pane__text">
          {segments.map((segment) => {
            if (segment.type === "text") {
              return (
                <span key={`text-${segment.start}-${segment.end}`}>
                  {segment.text}
                </span>
              );
            }
            return (
              <mark
                className={`comparison-highlight ${categoryClassName(
                  segment.entry.category as EntityCategory,
                )}`}
                key={`replacement-${segment.start}-${segment.end}-${segment.entry.token}`}
                title={segment.entry.token}
              >
                {segment.text}
              </mark>
            );
          })}
        </pre>
      </div>
    </section>
  );
}

type ScrollPositionKey = "scrollTop" | "scrollLeft";
type ScrollSizeKey = "scrollHeight" | "scrollWidth";
type ClientSizeKey = "clientHeight" | "clientWidth";

function syncAxis(
  source: HTMLDivElement,
  target: HTMLDivElement,
  positionKey: ScrollPositionKey,
  scrollSizeKey: ScrollSizeKey,
  clientSizeKey: ClientSizeKey,
): void {
  const sourceMax = source[scrollSizeKey] - source[clientSizeKey];
  const targetMax = target[scrollSizeKey] - target[clientSizeKey];
  const ratio = sourceMax > 0 ? source[positionKey] / sourceMax : 0;
  target[positionKey] = ratio * Math.max(0, targetMax);
}
