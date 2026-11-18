import { useEffect, useState } from "react";

import "../App.css";

import { progressHeadline, STARTING_PROGRESS, type ShellProgress } from "../domain/shellProgress";
import { texts } from "../i18n";
import {
  announceProgressReady,
  hideCurrentWindow,
  listenToShellProgress,
} from "../tauri/shellActions";

/** Content of the small corner window shown while Explorer menu actions run. */
export function ShellProgressPopup() {
  const [progress, setProgress] = useState<ShellProgress>(STARTING_PROGRESS);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let active = true;
    void listenToShellProgress(setProgress).then((dispose) => {
      if (active) {
        unlisten = dispose;
        void announceProgressReady();
      } else {
        dispose();
      }
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return <ShellProgressView progress={progress} onClose={() => void hideCurrentWindow()} />;
}

export function ShellProgressView({
  progress,
  onClose,
}: {
  progress: ShellProgress;
  onClose: () => void;
}) {
  const failed = progress.finished && progress.failed > 0;
  const several = progress.total > 1;
  const fill = progress.finished
    ? 100
    : several
      ? Math.round((progress.done / progress.total) * 100)
      : null;
  return (
    <div className={`shell-progress ${failed ? "shell-progress--failed" : ""}`} role="status">
      <div className="shell-progress__head">
        <span className="shell-progress__brand">{texts.shellActions.title}</span>
        <button
          type="button"
          className="shell-progress__close"
          aria-label={texts.shellActions.progress.close}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="shell-progress__title">{progressHeadline(progress)}</p>
      <p className="shell-progress__detail">
        {progress.finished ? progress.message : (progress.file ?? " ")}
      </p>
      <div className="shell-progress__track" aria-hidden="true">
        {fill === null ? (
          <div className="shell-progress__fill shell-progress__fill--moving" />
        ) : (
          <div className="shell-progress__fill" style={{ width: `${Math.max(fill, 4)}%` }} />
        )}
      </div>
    </div>
  );
}
