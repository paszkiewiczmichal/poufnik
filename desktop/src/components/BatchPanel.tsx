import { batchProgress } from "../domain/batchProcessing";
import { texts } from "../i18n";
import { PlusIcon } from "../ui/icons";
import type { BatchQueueItem } from "../types";

interface BatchPanelProps {
  items: BatchQueueItem[];
  running: boolean;
  message: string | null;
  error: string | null;
  disabled: boolean;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onRun: () => void;
  onExport: () => void;
  onClear: () => void;
  /** All files belong to one case: the same person gets the same token in every file. */
  sharedCase?: boolean;
  onSharedCaseChange?: (shared: boolean) => void;
}

export function BatchPanel({
  items,
  running,
  message,
  error,
  disabled,
  onAddFiles,
  onAddFolder,
  onRun,
  onExport,
  onClear,
  sharedCase = false,
  onSharedCaseChange,
}: BatchPanelProps) {
  const progress = batchProgress(items);
  const processed = progress.complete + progress.failed;
  const canRun = !disabled && !running && items.some((item) => item.status !== "done");
  const canExport = !running && items.some((item) => item.status === "done");

  return (
    <section className="batch-panel" aria-labelledby="batch-title">
      <h2 className="card-title" id="batch-title">
        {texts.batch.title}
      </h2>
      <p className="muted">{items.length === 0 ? texts.batch.empty : texts.batch.lead}</p>

      {onSharedCaseChange ? (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={sharedCase}
            disabled={running}
            onChange={(event) => onSharedCaseChange(event.target.checked)}
          />
          <span>
            <strong>{texts.batch.sharedCase}</strong> {texts.batch.sharedCaseNote}
          </span>
        </label>
      ) : null}

      <div className="batch-drop">
        <PlusIcon />
        <span>{texts.batch.dropHint}</span>
        <div className="toolbar">
          <button
            className="secondary-button secondary-button--compact"
            type="button"
            disabled={disabled || running}
            onClick={onAddFiles}
          >
            {texts.batch.addFiles}
          </button>
          <button
            className="secondary-button secondary-button--compact"
            type="button"
            disabled={disabled || running}
            onClick={onAddFolder}
          >
            {texts.batch.addFolder}
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <>
          <progress
            className="batch-progress"
            max={Math.max(1, progress.total)}
            value={processed}
            aria-label={texts.batch.progress(processed, progress.total)}
          />
          <div className="card batch-table">
            <div className="batch-table__head" aria-hidden="true">
              <span>{texts.batch.columnFile}</span>
              <span>{texts.batch.columnStatus}</span>
              <span>{texts.batch.columnDetections}</span>
            </div>
            <div role="list">
              {items.map((item) => (
                <article
                  className={`batch-item batch-item--${item.status}`}
                  key={item.id}
                  role="listitem"
                >
                  <span className="batch-item__name">
                    {item.filename}{" "}
                    <span className="muted">· {texts.batch.fileSize(item.size)}</span>
                  </span>
                  <span className="batch-item__status">{texts.batch.status[item.status]}</span>
                  <span className="batch-item__meta">{batchItemMeta(item)}</span>
                </article>
              ))}
            </div>
            <div className="batch-footer">
              <span>{texts.batch.progress(progress.complete, progress.total)}</span>
              <div className="toolbar">
                <button
                  className="ghost-button ghost-button--compact"
                  type="button"
                  disabled={running}
                  onClick={onClear}
                >
                  {texts.batch.clear}
                </button>
                <button
                  className="secondary-button secondary-button--compact"
                  type="button"
                  disabled={!canExport}
                  onClick={onExport}
                >
                  {texts.batch.export}
                </button>
                <button
                  className="primary-button primary-button--compact"
                  type="button"
                  disabled={!canRun}
                  onClick={onRun}
                >
                  {running ? texts.batch.running : texts.batch.run}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {message ? <p className="status-note">{message}</p> : null}
      {error ? (
        <p className="error-note" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function batchItemMeta(item: BatchQueueItem): string {
  if (item.status === "done") {
    return texts.batch.entityCount(item.entityCount ?? 0);
  }
  if (item.status === "error") {
    return item.error ?? texts.errors.generic;
  }
  // The column counts detections; a file not processed yet has none to show.
  return texts.batch.noDetectionsYet;
}
