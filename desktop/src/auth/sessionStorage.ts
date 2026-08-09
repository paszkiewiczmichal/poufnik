import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

const SESSION_PATH = "auth/session.json";
const BASIC_CHOICE_KEY = "poufnik.auth.basicChoice";
const BROWSER_SESSION_KEY = "poufnik.auth.session";

interface StoredSession {
  accessToken: string;
}

export async function readStoredAuthToken(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return readBrowserToken();
  }

  try {
    if (!(await exists(SESSION_PATH, { baseDir: BaseDirectory.AppLocalData }))) {
      return null;
    }
    const payload = JSON.parse(
      await readTextFile(SESSION_PATH, { baseDir: BaseDirectory.AppLocalData }),
    ) as Partial<StoredSession>;
    return typeof payload.accessToken === "string" ? payload.accessToken : null;
  } catch {
    return readBrowserToken();
  }
}

export async function saveStoredAuthToken(accessToken: string): Promise<void> {
  const payload = JSON.stringify({ accessToken } satisfies StoredSession);
  window.localStorage.setItem(BROWSER_SESSION_KEY, payload);
  if (!isTauriRuntime()) {
    return;
  }

  try {
    await mkdir("auth", { baseDir: BaseDirectory.AppLocalData, recursive: true });
    await writeTextFile(SESSION_PATH, payload, { baseDir: BaseDirectory.AppLocalData });
  } catch {
    // Browser fallback above remains the usable storage in tests and dev preview.
  }
}

export async function clearStoredAuthToken(): Promise<void> {
  window.localStorage.removeItem(BROWSER_SESSION_KEY);
  if (!isTauriRuntime()) {
    return;
  }
  try {
    if (await exists(SESSION_PATH, { baseDir: BaseDirectory.AppLocalData })) {
      await remove(SESSION_PATH, { baseDir: BaseDirectory.AppLocalData });
    }
  } catch {
    // Removing the fallback storage is enough to avoid reusing the token in browser mode.
  }
}

export function getStoredBasicChoice(): boolean {
  return window.localStorage.getItem(BASIC_CHOICE_KEY) === "true";
}

export function saveStoredBasicChoice(enabled: boolean): void {
  window.localStorage.setItem(BASIC_CHOICE_KEY, String(enabled));
}

function readBrowserToken(): string | null {
  const raw = window.localStorage.getItem(BROWSER_SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const payload = JSON.parse(raw) as Partial<StoredSession>;
    return typeof payload.accessToken === "string" ? payload.accessToken : null;
  } catch {
    return null;
  }
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

