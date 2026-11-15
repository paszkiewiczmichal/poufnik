import { describe, expect, it, vi } from "vitest";

import type { AnonymizerApiClient } from "../api/client";
import type { ReplacementMap } from "../types";
import { anonymizeClipboard, restoreClipboard, type ClipboardDeps } from "./clipboardActions";

function mapOf(person: string): ReplacementMap {
  return {
    document_fingerprint: person,
    entries: [{ token: "[OSOBA_1]", category: "PERSON", canonical_text: person }],
  };
}

function setup(clipboard: string, maps: ReplacementMap[] = []) {
  const written: string[] = [];
  const client = {
    analyze: vi.fn(async () => ({
      entities: [
        { category: "PERSON", start: 0, end: 12, text: "Jan Kowalski", status: "accepted" },
        { category: "DATE", start: 16, end: 26, text: "12.03.2026", status: "accepted" },
      ],
    })),
    anonymizeApiEntities: vi.fn(async (_text: string, entities: { status: string }[]) => ({
      anonymized_text: "[OSOBA_1] dnia 12.03.2026",
      replacement_map: mapOf("Jan Kowalski"),
      offset_map: entities.filter((entity) => entity.status === "accepted"),
    })),
    deanonymize: vi.fn(async (text: string, map: ReplacementMap) => ({
      original_text: text.replace("[OSOBA_1]", map.entries[0].canonical_text),
      warnings: [],
    })),
  };
  const deps: ClipboardDeps = {
    client: client as unknown as AnonymizerApiClient,
    readText: async () => clipboard,
    writeText: async (text) => {
      written.push(text);
    },
    excludedCategories: ["DATE"],
    customRules: [{ name: "Sygnatura", pattern: "XII C [0-9]+/[0-9]+", label: "SYGNATURA" }],
    rememberMap: vi.fn(async () => undefined),
    findMaps: async () =>
      maps.map((map) => ({ map, sourceName: null, outputName: null, mapFileName: null, savedAt: null })),
  };
  return { deps, client, written };
}

describe("clipboard shortcuts", () => {
  it("puts the anonymized text on the clipboard and keeps excluded categories", async () => {
    const { deps, client, written } = setup("Jan Kowalski dnia 12.03.2026");

    const outcome = await anonymizeClipboard(deps);

    expect(outcome).toEqual({ ok: true, replaced: 1 });
    expect(written).toEqual(["[OSOBA_1] dnia 12.03.2026"]);
    const sent = client.anonymizeApiEntities.mock.calls[0][1] as { category: string; status: string }[];
    expect(sent.find((entity) => entity.category === "DATE")?.status).toBe("rejected");
    expect(deps.rememberMap).toHaveBeenCalledTimes(1);
    // The account's own rules apply here as in the window.
    expect(client.analyze).toHaveBeenCalledWith("Jan Kowalski dnia 12.03.2026", deps.customRules);
  });

  it("leaves the clipboard unchanged when the map cannot be saved", async () => {
    const { deps, written } = setup("Jan Kowalski dnia 12.03.2026");
    deps.rememberMap = vi.fn(async () => {
      throw new Error("disk full");
    });

    await expect(anonymizeClipboard(deps)).rejects.toThrow("disk full");
    expect(written).toEqual([]);
  });

  it("leaves an empty clipboard alone", async () => {
    const { deps, client, written } = setup("   ");

    expect(await anonymizeClipboard(deps)).toEqual({ ok: false, reason: "empty" });
    expect(client.analyze).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });

  it("restores an AI answer with the one map that fits", async () => {
    const { deps, written } = setup("[OSOBA_1] zapłaci.", [mapOf("Jan Kowalski")]);

    expect(await restoreClipboard(deps)).toEqual({ ok: true, replaced: 1, warning: null });
    expect(written).toEqual(["Jan Kowalski zapłaci."]);
  });

  it("warns about tokens missing from the map, from the engine and mangled ones", async () => {
    const { deps, client, written } = setup(
      "[OSOBA_1] i [OSOBA_7] oraz [OSOBA 1].",
      [mapOf("Jan Kowalski")],
    );
    client.deanonymize.mockResolvedValueOnce({
      original_text: "Jan Kowalski i [OSOBA_7] oraz [OSOBA 1].",
      warnings: ["Unknown anonymization token [OSOBA_7] at offset 14."],
    });

    const outcome = await restoreClipboard(deps);

    expect(outcome).toEqual({
      ok: true,
      replaced: 1,
      warning:
        "W tekście zostały 2 oznaczenia, których nie ma w mapie: [OSOBA_7], [OSOBA 1]. Sprawdź je ręcznie.",
    });
    expect(written).toEqual(["Jan Kowalski i [OSOBA_7] oraz [OSOBA 1]."]);
  });

  it("does not guess between two cases and leaves the clipboard unchanged", async () => {
    const { deps, written } = setup("[OSOBA_1] zapłaci.", [mapOf("Jan Kowalski"), mapOf("Anna Nowak")]);

    expect(await restoreClipboard(deps)).toEqual({ ok: false, reason: "ambiguous_map" });
    expect(written).toEqual([]);
  });
});
