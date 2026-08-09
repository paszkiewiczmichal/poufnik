import { invoke } from "@tauri-apps/api/core";

import type { DetectedEntity, OffsetMapEntry, ProcessedDocument, ReplacementMap } from "../types";

const HISTORY_ENABLED_KEY = "anonymizer.history.enabled";

export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DocumentHistorySession {
  document: ProcessedDocument;
  entities: DetectedEntity[];
  anonymizedText: string;
  replacementMap: ReplacementMap;
  offsetMap?: OffsetMapEntry[];
}

export interface DocumentHistoryEntry {
  id: number;
  createdAt: string;
  session: DocumentHistorySession;
}

export interface DocumentHistorySummary {
  id: number;
  createdAt: string;
  filename: string;
  documentFormat: string;
  documentSource: string;
  entityCount: number;
  acceptedEntityCount: number;
}

export interface DocumentHistoryBackend {
  save(session: DocumentHistorySession): Promise<DocumentHistoryEntry>;
  list(): Promise<DocumentHistorySummary[]>;
  get(entryId: number): Promise<DocumentHistoryEntry | null>;
  delete(entryId: number): Promise<void>;
  clear(): Promise<void>;
}

export const tauriDocumentHistoryBackend: DocumentHistoryBackend = {
  save: (session) =>
    invoke<DocumentHistoryEntry>("save_document_history_entry", {
      session: toTauriSession(session),
    }).then(fromTauriEntry),
  list: () => invoke<DocumentHistorySummary[]>("list_document_history"),
  get: (entryId) =>
    invoke<DocumentHistoryEntry | null>("get_document_history_entry", { entryId }).then((entry) =>
      entry ? fromTauriEntry(entry) : null,
    ),
  delete: (entryId) => invoke("delete_document_history_entry", { entryId }),
  clear: () => invoke("clear_document_history"),
};

export function getDocumentHistoryEnabled(
  storage: LocalStorageLike = window.localStorage,
): boolean {
  return storage.getItem(HISTORY_ENABLED_KEY) === "true";
}

export function setDocumentHistoryEnabled(
  enabled: boolean,
  storage: LocalStorageLike = window.localStorage,
): void {
  storage.setItem(HISTORY_ENABLED_KEY, enabled ? "true" : "false");
}

export async function saveDocumentHistoryEntryIfEnabled(
  session: DocumentHistorySession,
  options: {
    storage?: LocalStorageLike;
    backend?: DocumentHistoryBackend;
  } = {},
): Promise<DocumentHistoryEntry | null> {
  const storage = options.storage ?? window.localStorage;
  const backend = options.backend ?? tauriDocumentHistoryBackend;
  if (!getDocumentHistoryEnabled(storage)) {
    return null;
  }
  return backend.save(session);
}

function toTauriSession(session: DocumentHistorySession) {
  return {
    document: session.document,
    entities: session.entities,
    anonymizedText: session.anonymizedText,
    replacementMap: session.replacementMap,
    offsetMap: session.offsetMap ?? [],
  };
}

function fromTauriEntry(entry: DocumentHistoryEntry): DocumentHistoryEntry {
  return {
    ...entry,
    session: fromTauriSession(entry.session),
  };
}

function fromTauriSession(session: DocumentHistorySession): DocumentHistorySession {
  return {
    document: session.document,
    entities: session.entities,
    anonymizedText: session.anonymizedText,
    replacementMap: session.replacementMap,
    offsetMap: session.offsetMap ?? [],
  };
}
