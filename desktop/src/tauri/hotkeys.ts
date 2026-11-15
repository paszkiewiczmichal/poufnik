import { register, unregister } from "@tauri-apps/plugin-global-shortcut";

import type { LocalStorageLike } from "./customRules";

// Not Ctrl+Alt+Shift+A: on the Polish keyboard Ctrl+Alt is AltGr, so that is a capital "Ą"
// and the shortcut would swallow it in every program. AltGr+P and AltGr+R type nothing.
export const ANONYMIZE_SHORTCUT = "CommandOrControl+Alt+Shift+P";
export const RESTORE_SHORTCUT = "CommandOrControl+Alt+Shift+R";
const ENABLED_KEY = "anonymizer.hotkeys.enabled";

export function loadHotkeysEnabled(storage?: LocalStorageLike): boolean {
  try {
    return (storage ?? window.localStorage).getItem(ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveHotkeysEnabled(enabled: boolean, storage?: LocalStorageLike): void {
  (storage ?? window.localStorage).setItem(ENABLED_KEY, String(enabled));
}

// Registering and removing run one after another, in the order they were asked for: a quick
// off/on (or a React effect re-run) must not let a late "remove" undo the newer registration.
let pending: Promise<unknown> = Promise.resolve();

function inOrder(task: () => Promise<unknown>): void {
  pending = pending.then(task).catch((error: unknown) => {
    // Taken by another program, or outside the desktop app: the shortcuts just do not work.
    console.warn("Poufnik: global shortcuts unavailable", error);
  });
}

/** Registers both shortcuts; returns a function that removes them. */
export function registerClipboardShortcuts(handlers: {
  onAnonymize: () => void;
  onRestore: () => void;
}): () => void {
  inOrder(async () => {
    // The plugin calls back on both press and release; act once, on press.
    await register(ANONYMIZE_SHORTCUT, (event) => {
      if (event.state === "Pressed") {
        handlers.onAnonymize();
      }
    });
    await register(RESTORE_SHORTCUT, (event) => {
      if (event.state === "Pressed") {
        handlers.onRestore();
      }
    });
  });
  return () => inOrder(() => unregister([ANONYMIZE_SHORTCUT, RESTORE_SHORTCUT]));
}
