import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { exists, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";

import type { ShellActionRequest } from "../domain/shellActions";
import type { EngineEndpoint } from "../types";
import { getEngineStatus, listenToEngineStatus } from "./engine";

export const SHELL_ACTION_EVENT = "shell://action";

// Remembered replacement maps (encrypted, 30 days) live in ./rememberedMaps.
export {
  deleteRememberedMaps,
  findReplacementMaps,
  loadRememberMaps,
  rememberReplacementMap,
  removeExpiredMaps,
  saveRememberMaps,
} from "./rememberedMaps";

export function takeShellActions(): Promise<ShellActionRequest[]> {
  return invoke<ShellActionRequest[]>("take_shell_actions");
}

/** Quits Poufnik when it was started only for menu actions (window never shown). */
export function finishShellActions(): Promise<void> {
  return invoke("finish_shell_actions");
}

export function showMainWindow(): Promise<void> {
  return invoke("show_main_window_command");
}

export function listenToShellActions(handler: () => void): Promise<UnlistenFn> {
  return listen(SHELL_ACTION_EVENT, () => handler());
}

export async function notify(title: string, body: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    }
  } catch {
    // A missing notification never stops the action itself.
  }
}

/** Resolves when the engine is ready; rejects with its error when it fails or never starts. */
export function waitForEngine(timeoutMs = 180_000): Promise<EngineEndpoint> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unlisten: UnlistenFn | null = null;
    const finish = (result: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      unlisten?.();
      result();
    };
    const timer = window.setTimeout(
      () => finish(() => reject(new Error("Silnik Poufnika nie uruchomił się na czas."))),
      timeoutMs,
    );
    const apply = (event: Awaited<ReturnType<typeof getEngineStatus>>) => {
      if (event.status === "ready") {
        finish(() => resolve(event.endpoint));
      } else if (event.status === "failed") {
        finish(() => reject(new Error(event.message)));
      }
    };
    void listenToEngineStatus(apply).then((dispose) => {
      if (settled) {
        dispose();
      } else {
        unlisten = dispose;
      }
    });
    void getEngineStatus().then(apply, () => undefined);
  });
}

export async function writeOutputFile(path: string, contents: Blob | string): Promise<void> {
  if (typeof contents === "string") {
    await writeTextFile(path, contents);
  } else {
    await writeFile(path, new Uint8Array(await contents.arrayBuffer()));
  }
}

export { exists as pathExists, readTextFile };

