import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { PreviewKind } from "../domain/preview";
import { texts } from "../i18n";
import { toUserMessage } from "../api/errors";
import { FilePreview } from "./FilePreview";
import { PreviewFrame } from "./PreviewFrame";

export interface PreviewFile {
  blob: Blob;
  kind: PreviewKind;
  notice: string | null;
  /** Format of an "office" file (xlsx, pptx, ...), needed to convert it for the preview. */
  format?: string;
}

interface DocumentPreviewPairProps {
  /** The original file as picked, when the window can draw it. */
  original: { file: Blob; kind: PreviewKind; format?: string } | null;
  /** Builds the anonymized file exactly as "Eksportuj" would save it. */
  loadAnonymized: () => Promise<PreviewFile | null>;
  /** Changes whenever the anonymization changes, so the preview is built again. */
  version: string;
  /** A notice already shown above (after an export) is not repeated here. */
  shownNotice?: string | null;
}

// Both panes zoom together, so the same place is compared at the same size.
export const PREVIEW_ZOOM_LEVELS = [1, 1.5, 2, 3];

export function nextZoom(current: number, direction: 1 | -1): number {
  const index = PREVIEW_ZOOM_LEVELS.indexOf(current);
  const next = Math.min(PREVIEW_ZOOM_LEVELS.length - 1, Math.max(0, index + direction));
  return PREVIEW_ZOOM_LEVELS[next];
}

/** "Przed" and "Po" side by side, both drawn 1:1: the anonymized file is the one saved. */
export function DocumentPreviewPair({
  original,
  loadAnonymized,
  version,
  shownNotice = null,
}: DocumentPreviewPairProps) {
  const [anonymized, setAnonymized] = useState<PreviewFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomStyle = { "--preview-zoom": zoom } as CSSProperties;
  const pairRef = useRef<HTMLDivElement>(null);

  // Ctrl + mouse wheel zooms the pages, not the whole window. React's wheel handler is
  // passive and cannot stop the window zoom, hence a listener of our own.
  useEffect(() => {
    const pair = pairRef.current;
    if (!pair) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        setZoom((current) => nextZoom(current, event.deltaY < 0 ? 1 : -1));
      }
    };
    pair.addEventListener("wheel", onWheel, { passive: false });
    return () => pair.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAnonymized(null);
    setError(null);
    loadAnonymized().then(
      (file) => {
        if (!cancelled) {
          setAnonymized(file);
        }
      },
      (failure: unknown) => {
        if (!cancelled) {
          setError(toUserMessage(failure));
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // The file is rebuilt only when the anonymization itself changes.
  }, [version]);

  return (
    <div className="document-preview">
      {anonymized?.notice && anonymized.notice !== shownNotice ? (
        <p className="status-note">{anonymized.notice}</p>
      ) : null}
      <div className="preview-zoom" role="group" aria-label={texts.preview.zoom}>
        <button
          className="icon-button"
          type="button"
          aria-label={texts.preview.zoomOut}
          title={texts.preview.zoomOut}
          disabled={zoom === PREVIEW_ZOOM_LEVELS[0]}
          onClick={() => setZoom(nextZoom(zoom, -1))}
        >
          −
        </button>
        <span className="preview-zoom__value" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="icon-button"
          type="button"
          aria-label={texts.preview.zoomIn}
          title={texts.preview.zoomIn}
          disabled={zoom === PREVIEW_ZOOM_LEVELS[PREVIEW_ZOOM_LEVELS.length - 1]}
          onClick={() => setZoom(nextZoom(zoom, 1))}
        >
          +
        </button>
        {zoom !== 1 ? (
          <button
            className="ghost-button ghost-button--compact"
            type="button"
            onClick={() => setZoom(1)}
          >
            {texts.preview.zoomFit}
          </button>
        ) : null}
      </div>
      <div className="document-preview-pair" style={zoomStyle} ref={pairRef}>
        {original ? (
          <FilePreview
            file={original.file}
            kind={original.kind}
            format={original.format}
            label={texts.preview.before}
          />
        ) : null}
        {anonymized ? (
          <FilePreview
            file={anonymized.blob}
            kind={anonymized.kind}
            format={anonymized.format}
            label={texts.preview.after}
          />
        ) : (
          <PreviewFrame label={texts.preview.after}>
            {error ? (
              <p className="error-note" role="alert">
                {error}
              </p>
            ) : (
              <p className="muted">{texts.preview.building}</p>
            )}
          </PreviewFrame>
        )}
      </div>
    </div>
  );
}
