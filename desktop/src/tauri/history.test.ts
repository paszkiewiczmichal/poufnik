import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DetectedEntity, ProcessedDocument, ReplacementMap } from "../types";
import {
  type DocumentHistoryBackend,
  type DocumentHistoryEntry,
  type DocumentHistorySession,
  getDocumentHistoryEnabled,
  saveDocumentHistoryEntryIfEnabled,
  setDocumentHistoryEnabled,
} from "./history";

describe("document history preferences and persistence facade", () => {
  let storage: MemoryStorage;
  let backend: MemoryHistoryBackend;

  beforeEach(() => {
    storage = new MemoryStorage();
    backend = new MemoryHistoryBackend();
  });

  it("keeps document history disabled by default", async () => {
    const saveSpy = vi.spyOn(backend, "save");

    await expect(
      saveDocumentHistoryEntryIfEnabled(sampleSession(), { storage, backend }),
    ).resolves.toBeNull();

    expect(getDocumentHistoryEnabled(storage)).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(await backend.list()).toEqual([]);
  });

  it("round-trips a full anonymization session when history is enabled", async () => {
    setDocumentHistoryEnabled(true, storage);

    const saved = await saveDocumentHistoryEntryIfEnabled(sampleSession(), {
      storage,
      backend,
    });
    const loaded = await backend.get(saved!.id);

    expect(saved).not.toBeNull();
    expect(loaded?.session).toEqual(sampleSession());
    expect(await backend.list()).toMatchObject([
      {
        filename: "umowa.txt",
        entityCount: 2,
        acceptedEntityCount: 1,
      },
    ]);
  });

  it("deletes single entries and clears all history", async () => {
    setDocumentHistoryEnabled(true, storage);
    const first = await backend.save(sampleSession("pierwsza.txt"));
    const second = await backend.save(sampleSession("druga.txt"));

    await backend.delete(first.id);

    expect(await backend.get(first.id)).toBeNull();
    expect((await backend.list()).map((entry) => entry.id)).toEqual([second.id]);

    await backend.clear();

    expect(await backend.list()).toEqual([]);
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class MemoryHistoryBackend implements DocumentHistoryBackend {
  private nextId = 1;
  private readonly entries: DocumentHistoryEntry[] = [];

  async save(session: DocumentHistorySession): Promise<DocumentHistoryEntry> {
    const entry = {
      id: this.nextId,
      createdAt: new Date(this.nextId * 1000).toISOString(),
      session: structuredClone(session),
    };
    this.nextId += 1;
    this.entries.unshift(entry);
    return structuredClone(entry);
  }

  async list() {
    return this.entries.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      filename: entry.session.document.filename,
      documentFormat: entry.session.document.format,
      documentSource: entry.session.document.source,
      entityCount: entry.session.entities.length,
      acceptedEntityCount: entry.session.entities.filter((entity) => entity.status !== "rejected")
        .length,
    }));
  }

  async get(entryId: number) {
    return structuredClone(this.entries.find((entry) => entry.id === entryId) ?? null);
  }

  async delete(entryId: number) {
    const index = this.entries.findIndex((entry) => entry.id === entryId);
    if (index >= 0) {
      this.entries.splice(index, 1);
    }
  }

  async clear() {
    this.entries.splice(0);
  }
}

function sampleSession(filename = "umowa.txt"): DocumentHistorySession {
  const document: ProcessedDocument = {
    filename,
    format: "txt",
    source: "parsed",
    page_count: 1,
    text: "Jan Kowalski ma PESEL 44051401359.",
  };
  const entities: DetectedEntity[] = [
    entity("entity-1", "PERSON", "Jan Kowalski", 0, 12, "accepted"),
    entity("entity-2", "PESEL", "44051401359", 22, 33, "rejected"),
  ];
  const replacementMap: ReplacementMap = {
    entries: [
      {
        token: "[OSOBA_1]",
        category: "PERSON",
        canonical_text: "Jan Kowalski",
        variants: ["Jan Kowalski"],
      },
    ],
    document_fingerprint: "abc",
  };
  return {
    document,
    entities,
    anonymizedText: "[OSOBA_1] ma PESEL 44051401359.",
    replacementMap,
  };
}

function entity(
  id: string,
  category: DetectedEntity["category"],
  text: string,
  start: number,
  end: number,
  status: DetectedEntity["status"],
): DetectedEntity {
  return {
    id,
    category,
    start,
    end,
    text,
    confidence: 1,
    source: category === "PESEL" ? "regex" : "ner",
    validation: category === "PESEL" ? "passed" : "not_applicable",
    status,
    entity_group_id: `${category}-${id}`,
    canonical_text: text,
  };
}
