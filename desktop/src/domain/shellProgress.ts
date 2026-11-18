import { texts } from "../i18n";
import type { ShellAction } from "./shellActions";

// State of the small progress window shown while Explorer menu actions run in the background.
export interface ShellProgress {
  action: ShellAction | null;
  /** File being processed now; null before the engine is ready and after the last one. */
  file: string | null;
  done: number;
  total: number;
  failed: number;
  finished: boolean;
  /** Result shown when finished. */
  message: string | null;
}

export const STARTING_PROGRESS: ShellProgress = {
  action: null,
  file: null,
  done: 0,
  total: 0,
  failed: 0,
  finished: false,
  message: null,
};

/** One file: its own result. Several: a count, plus the last error if any file failed. */
export function finishedMessage(
  total: number,
  failed: number,
  lastMessage: string | null,
  lastFailure: string | null,
): string {
  if (total === 1 && lastMessage) {
    return lastMessage;
  }
  if (failed === 0) {
    return texts.shellActions.progress.allDone(total);
  }
  const summary = texts.shellActions.progress.partlyDone(total - failed, total);
  return lastFailure ? `${summary} ${lastFailure}` : summary;
}

/** Headline of the progress window: what Poufnik does now, with "2 z 5" for several files. */
export function progressHeadline(progress: ShellProgress): string {
  const { progress: labels } = texts.shellActions;
  if (progress.finished) {
    return progress.failed > 0 ? labels.problem : labels.done;
  }
  if (progress.action === null) {
    return labels.starting;
  }
  const working = labels.working[progress.action] ?? labels.starting;
  if (progress.total > 1) {
    const current = Math.min(progress.done + 1, progress.total);
    return `${working} ${labels.counter(current, progress.total)}`;
  }
  return working;
}
