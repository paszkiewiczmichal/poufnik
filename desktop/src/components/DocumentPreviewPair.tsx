import { useEffect, useState } from "react";

import type { PreviewKind } from "../domain/preview";
import { texts } from "../i18n";
import { toUserMessage } from "../api/errors";
import { FilePreview } from "./FilePreview";

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

/** "Przed" and "Po" side by side, both drawn 1:1: the anonymized file is the one saved. */
export function DocumentPreviewPair({
  original,
  loadAnonymized,
  version,
  shownNotice = null,
}: DocumentPreviewPairProps) {
  const [anonymized, setAnonymized] = useState<PreviewFile | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div className="document-preview-pair">
      {original ? (
        <FilePreview
          file={original.file}
          kind={original.kind}
          format={original.format}
          label={texts.preview.before}
        />
      ) : null}
      <div className="document-preview-pair__after">
        {anonymized ? (
          <>
            {anonymized.notice && anonymized.notice !== shownNotice ? (
              <p className="status-note">{anonymized.notice}</p>
            ) : null}
            <FilePreview
              file={anonymized.blob}
              kind={anonymized.kind}
              format={anonymized.format}
              label={texts.preview.after}
            />
          </>
        ) : error ? (
          <p className="error-note" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted">{texts.preview.building}</p>
        )}
      </div>
    </div>
  );
}
