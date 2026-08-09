import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateConsent = boolean | null;
export type UpdateCheckResult =
  | { status: "skipped" }
  | { status: "none" }
  | { status: "available"; update: Update };

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const CONSENT_KEY = "anonymizer.updates.consent";
const LAST_CHECK_KEY = "anonymizer.updates.lastCheckAt";

type UpdateCheck = typeof check;
type LocalStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface CheckForUpdateOptions {
  force?: boolean;
  now?: number;
  storage?: LocalStorageLike;
  checkImpl?: UpdateCheck;
}

export function getUpdateConsent(storage: LocalStorageLike = window.localStorage): UpdateConsent {
  const value = storage.getItem(CONSENT_KEY);
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

export function saveUpdateConsent(
  consent: boolean,
  storage: LocalStorageLike = window.localStorage,
): void {
  storage.setItem(CONSENT_KEY, String(consent));
  if (!consent) {
    storage.removeItem(LAST_CHECK_KEY);
  }
}

export function shouldCheckForUpdates(
  consent: UpdateConsent,
  lastCheckAt: number | null,
  now = Date.now(),
): boolean {
  return consent === true && (lastCheckAt === null || now - lastCheckAt >= UPDATE_CHECK_INTERVAL_MS);
}

export async function checkForUpdate({
  force = false,
  now = Date.now(),
  storage = window.localStorage,
  checkImpl = check,
}: CheckForUpdateOptions = {}): Promise<UpdateCheckResult> {
  const consent = getUpdateConsent(storage);
  const lastCheckAt = parseLastCheckAt(storage);
  if (consent !== true) {
    return { status: "skipped" };
  }
  if (!force && !shouldCheckForUpdates(consent, lastCheckAt, now)) {
    return { status: "skipped" };
  }

  storage.setItem(LAST_CHECK_KEY, String(now));
  const update = await checkImpl({ timeout: 30000 });
  if (!update) {
    return { status: "none" };
  }
  return { status: "available", update };
}

export async function installUpdate(
  update: Update,
  onEvent?: (event: DownloadEvent) => void,
): Promise<void> {
  await update.downloadAndInstall(onEvent);
  await relaunch();
}

function parseLastCheckAt(storage: LocalStorageLike): number | null {
  const raw = storage.getItem(LAST_CHECK_KEY);
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
