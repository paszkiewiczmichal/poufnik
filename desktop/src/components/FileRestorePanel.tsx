import type { MapCandidate } from "../domain/mapLinking";
import { texts } from "../i18n";
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
}: FileRestorePanelProps) {
  return (
    <section className="card file-restore" aria-labelledby="file-restore-title">
      <h3 className="card-title" id="file-restore-title">
        {texts.deanonymization.fileTitle}
      </h3>
      <p className="muted">{texts.deanonymization.fileLead}</p>
      <div className="toolbar">
        <button
          className="secondary-button"
          type="button"
          disabled={disabled || state.status === "loading"}
          onClick={onChooseFile}
        >
          {state.status === "loading"
            ? texts.deanonymization.fileWorking
            : texts.deanonymization.fileButton}
        </button>
        {onLoadMap ? (
          <button className="ghost-button" type="button" onClick={onLoadMap}>
            {texts.deanonymization.loadMapShort}
          </button>
        ) : null}
      </div>
      {mapLoaded ? <p className="muted">{texts.deanonymization.mapLoaded}</p> : null}

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
    </section>
  );
}
