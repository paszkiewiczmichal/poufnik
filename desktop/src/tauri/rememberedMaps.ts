import { invoke } from "@tauri-apps/api/core";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { mkdir, readDir, readFile, readTextFile, remove, writeFile } from "@tauri-apps/plugin-fs";

import type { MapCandidate } from "../domain/mapLinking";
import { directoryOf } from "../domain/shellActions";
import type { ReplacementMap } from "../types";
import type { LocalStorageLike } from "./customRules";

// Maps written by every anonymization, kept so "Przywróć dane" can find them without asking.
// They hold the original personal data, so they are encrypted at rest (Windows DPAPI, tied to
// the current user; see src-tauri/src/map_protect.rs) and removed after 30 days.
// Maps the user saves explicitly (_poufnik_mapa.json) are a different thing and never touched here.
const MAP_DIRECTORY = "menu-maps";
const PROTECTED_SUFFIX = ".pmap";
const LEGACY_SUFFIX = ".json"; // plaintext, written by Poufnik 1.0.26 and earlier
const MAP_SUFFIX = "_poufnik_mapa.json";
export const REMEMBERED_MAP_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const REMEMBER_KEY = "anonymizer.maps.remember";

export function loadRememberMaps(storage?: LocalStorageLike): boolean {
  try {
    return (storage ?? window.localStorage).getItem(REMEMBER_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveRememberMaps(enabled: boolean, storage?: LocalStorageLike): void {
  (storage ?? window.localStorage).setItem(REMEMBER_KEY, String(enabled));
}

interface StoredMap {
  version: 1;
  savedAt: number;
  sourceName: string | null;
  outputName: string | null;
  map: ReplacementMap;
}

async function protectText(text: string): Promise<Uint8Array> {
  const bytes = await invoke<ArrayBuffer>("protect_map", new TextEncoder().encode(text));
  return new Uint8Array(bytes);
}

async function unprotectBytes(bytes: Uint8Array): Promise<string> {
  const plain = await invoke<ArrayBuffer>("unprotect_map", bytes);
  return new TextDecoder().decode(plain);
}

async function mapDirectory(): Promise<string> {
  const directory = await join(await appLocalDataDir(), MAP_DIRECTORY);
  await mkdir(directory, { recursive: true });
  return directory;
}

/**
 * Remembers a map with the names that link it to files later: the original document and the
 * anonymized file. Every anonymization calls this (window, batch, context menu), so "Przywróć
 * dane" finds the map without asking. Does nothing when the user turned remembering off. Never
 * writes plaintext: when encryption fails the error propagates.
 */
export async function rememberReplacementMap(
  map: ReplacementMap,
  names: { sourceName: string | null; outputName: string | null },
): Promise<void> {
  if (!loadRememberMaps() || map.entries.length === 0) {
    return;
  }
  await removeExpiredMaps().catch(() => undefined);
  const directory = await mapDirectory();
  const savedAt = Date.now();
  const record: StoredMap = { version: 1, savedAt, ...names, map };
  const encrypted = await protectText(JSON.stringify(record));
  // Two maps finished in the same millisecond (batch, shortcut) must not overwrite each other.
  const name = `${savedAt}-${crypto.randomUUID().slice(0, 8)}${PROTECTED_SUFFIX}`;
  await writeFile(await join(directory, name), encrypted);
}

/** Removes remembered maps older than 30 days; returns how many were removed. */
export async function removeExpiredMaps(now = Date.now()): Promise<number> {
  const directory = await mapDirectory();
  let removed = 0;
  for (const entry of await readDir(directory)) {
    if (!entry.isFile || !isRememberedMapName(entry.name)) {
      continue;
    }
    const savedAt = Number.parseInt(entry.name, 10);
    if (Number.isFinite(savedAt) && now - savedAt > REMEMBERED_MAP_MAX_AGE_DAYS * DAY_MS) {
      await remove(await join(directory, entry.name));
      removed += 1;
    }
  }
  return removed;
}

/** Deletes every remembered map (the whole folder content); returns how many files went. */
export async function deleteRememberedMaps(): Promise<number> {
  const directory = await mapDirectory();
  let removed = 0;
  for (const entry of await readDir(directory)) {
    if (entry.isFile) {
      await remove(await join(directory, entry.name));
      removed += 1;
    }
  }
  return removed;
}

/**
 * Candidate maps for restoring `inputPath`: map files next to it first (the user put them
 * there), then the remembered ones, newest first. `inputPath` may be null (a file picked in
 * the browser has no path).
 */
export async function findReplacementMaps(inputPath: string | null): Promise<MapCandidate[]> {
  const candidates: MapCandidate[] = [];
  if (inputPath) {
    const inputDirectory = directoryOf(inputPath);
    const nextToFile = await readDir(inputDirectory)
      .then((entries) =>
        entries.filter((e) => e.isFile && e.name.endsWith(MAP_SUFFIX)).map((e) => e.name),
      )
      .catch(() => [] as string[]);
    for (const name of nextToFile) {
      const stored = await readStoredMap(await readTextFile(await join(inputDirectory, name)).catch(() => ""));
      if (stored) {
        candidates.push({ ...stored, mapFileName: name });
      }
    }
  }
  const directory = await mapDirectory();
  const remembered = (await readDir(directory))
    .filter((entry) => entry.isFile && isRememberedMapName(entry.name))
    .map((entry) => entry.name)
    .sort(byNewestName);
  for (const name of remembered) {
    const path = await join(directory, name);
    const stored = await readRememberedFile(path, name);
    if (stored) {
      candidates.push({ ...stored, mapFileName: null });
    }
  }
  return candidates;
}

async function readRememberedFile(
  path: string,
  name: string,
): Promise<Omit<MapCandidate, "mapFileName"> | null> {
  if (name.endsWith(PROTECTED_SUFFIX)) {
    try {
      return await readStoredMap(await unprotectBytes(await readFile(path)));
    } catch {
      return null; // another Windows user, or a damaged file
    }
  }
  // An old plaintext record: still readable, and re-saved encrypted so it stops lying around.
  let text: string;
  try {
    text = await readTextFile(path);
  } catch {
    return null;
  }
  const stored = await readStoredMap(text);
  if (stored) {
    try {
      await writeFile(path.slice(0, -LEGACY_SUFFIX.length) + PROTECTED_SUFFIX, await protectText(text));
      await remove(path);
    } catch {
      // Stays as it was; tried again at the next lookup.
    }
  }
  return stored;
}

function isRememberedMapName(name: string): boolean {
  return name.endsWith(PROTECTED_SUFFIX) || name.endsWith(LEGACY_SUFFIX);
}

/** A stored record, or a bare map (saved by the user, or by Poufnik before 1.0.26). */
export async function readStoredMap(text: string): Promise<Omit<MapCandidate, "mapFileName"> | null> {
  try {
    const parsed = JSON.parse(text) as Partial<StoredMap> & ReplacementMap;
    if (parsed?.map && Array.isArray(parsed.map.entries)) {
      return {
        map: parsed.map,
        sourceName: parsed.sourceName ?? null,
        outputName: parsed.outputName ?? null,
        savedAt: parsed.savedAt ?? null,
      };
    }
    if (Array.isArray(parsed?.entries)) {
      return { map: parsed, sourceName: null, outputName: null, savedAt: null };
    }
    return null;
  } catch {
    return null;
  }
}

function byNewestName(left: string, right: string): number {
  return Number.parseInt(right, 10) - Number.parseInt(left, 10);
}
