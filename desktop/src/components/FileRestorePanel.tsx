import { useState } from "react";
import type { DragEvent } from "react";

import type { MapCandidate } from "../domain/mapLinking";
import { texts } from "../i18n";
import { UploadIcon } from "../ui/icons";
import { MapPasswordForm } from "./MapPasswordForm";

export interface FileRestoreState {
  status: "idle" | "loading" | "choose" | "done" | "error";
  message: string | null;
  /** Maps to choose from when several fit the file and would restore it differently. */
  choices: MapCandidate[];
}

export const IDLE_FILE_RESTORE: FileRestoreState = { status: "idle", message: null, choices: [] };

interface FileRestorePanelProps {
  state: FileRestoreState;
  disabled: boolean;
  onChooseFile: () => void;
  onChooseMap: (candidate: MapCandidate) => void;
  onCancelChoice: () => void;
  /** Loads a map by hand (plain or encrypted); it is then used first. */
  onLoadMap?: () => void;
  mapLoaded?: boolean;
  /** An encrypted map waiting for its password. */
  lockedMap?: { error: string | null } | null;
  onUnlockMap?: (password: string) => void;
  /**
   * "card" - a box under the pasted text (result tab); "tool" - the "Przywracanie" screen
   * with a large drop zone like the import screen.
   */
  variant?: "card" | "tool";
  onDropFile?: (file: File) => void;
}

/** Restoring the original data into a file that came back from an AI chat, in its own format. */
export function FileRestorePanel({
  state,
  disabled,
  onChooseFile,
  onChooseMap,
  onCancelChoice,
  onLoadMap,
  mapLoaded = false,
  lockedMap = null,
  onUnlockMap,
  variant = "card",
  onDropFile,
}: FileRestorePanelProps) {
  const [dragActive, setDragActive] = useState(false);
  const busy = disabled || state.status === "loading";
  const buttonLabel =
    state.status === "loading" ? texts.deanonymization.fileWorking : texts.deanonymization.fileButton;

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files.item(0);
    if (file && !busy) {
      onDropFile?.(file);
    }
  };

  const mapRow = onLoadMap ? (
    <div className="file-restore__map">
      <button className="ghost-button ghost-button--compact" type="button" onClick={onLoadMap}>
        {texts.deanonymization.loadMapShort}
      </button>
      <span className="muted">
        {mapLoaded ? texts.deanonymization.mapLoaded : texts.deanonymization.mapHint}
      </span>
    </div>
  ) : null;

  const details = (
    <>
      {lockedMap && onUnlockMap ? (
        <MapPasswordForm error={lockedMap.error} onUnlock={onUnlockMap} />
      ) : null}

      {state.status === "choose" && (
        <div className="file-restore__choices">
          <p>{texts.deanonymization.fileChoose}</p>
          <ul>
            {state.choices.map((candidate, index) => (
              <li key={`${candidate.savedAt ?? "x"}-${index}`}>
                <button
                  className="link-button"
                  type="button"
                  onClick={() => onChooseMap(candidate)}
                >
                  {texts.deanonymization.fileChoiceLabel(
                    candidate.sourceName ?? candidate.mapFileName,
                    candidate.savedAt,
                  )}
                </button>
              </li>
            ))}
          </ul>
          <button className="link-button" type="button" onClick={onCancelChoice}>
            {texts.deanonymization.fileCancelChoice}
          </button>
        </div>
      )}

      {state.message && (
        <p
          className={state.status === "error" ? "error-note" : "status-note"}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      )}
    </>
  );

  if (variant === "tool") {
    return (
      <section
        className="file-restore file-restore--tool"
        aria-label={texts.deanonymization.toolTitle}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <div
          className={`drop-zone ${dragActive ? "drop-zone--active" : ""}`}
          onClick={() => {
            if (!busy) {
              onChooseFile();
            }
          }}
        >
          <UploadIcon className="drop-zone__icon" />
          <div className="drop-zone__title">
            {dragActive ? texts.deanonymization.toolDropActive : texts.deanonymization.toolDropTitle}
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onChooseFile();
            }}
          >
            {buttonLabel}
          </button>
          <div className="drop-zone__formats">{texts.deanonymization.toolFormats}</div>
        </div>
        {mapRow}
        {details}
      </section>
    );
  }

  return (
    <section className="card card--padded file-restore" aria-labelledby="file-restore-title">
      <h3 className="card-title" id="file-restore-title">
        {texts.deanonymization.fileTitle}
      </h3>
      <p className="muted">{texts.deanonymization.fileLead}</p>
      <div className="toolbar">
        <button className="secondary-button" type="button" disabled={busy} onClick={onChooseFile}>
          {buttonLabel}
        </button>
        {onLoadMap ? (
          <button className="secondary-button" type="button" disabled={busy} onClick={onLoadMap}>
            {texts.deanonymization.loadMapShort}
          </button>
        ) : null}
      </div>
      {onLoadMap ? (
        <p className="muted">
          {mapLoaded ? texts.deanonymization.mapLoaded : texts.deanonymization.mapHint}
        </p>
      ) : null}
      {details}
    </section>
  );
}
