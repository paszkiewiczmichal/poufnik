import { describe, expect, it } from "vitest";

import type { DetectedEntity, OffsetMapEntry } from "../types";
import { buildReportRequest, sha256Hex } from "./report";

function entry(token: string, category: string): OffsetMapEntry {
  return {
    token,
    category,
    original_start: 0,
    original_end: 1,
    anonymized_start: 0,
    anonymized_end: 1,
  };
}

function entity(status: "accepted" | "rejected", source: DetectedEntity["source"]): DetectedEntity {
  return { status, source, text: "Jan Kowalski" } as unknown as DetectedEntity;
}

describe("buildReportRequest", () => {
  it("counts every token and the user's decisions, and carries no document value", () => {
    const request = buildReportRequest({
      documentName: "umowa_poufnik.docx",
      documentFormat: "docx",
      pageCount: 2,
      sourceSha256: null,
      appVersion: "1.0.26",
      offsetMap: [
        entry("[OSOBA_1]", "PERSON"),
        entry("[OSOBA_1]", "PERSON"),
        entry("[PESEL_1]", "PESEL"),
      ],
      entities: [
        entity("accepted", "ner"),
        entity("rejected", "dictionary"),
        entity("accepted", "regex"),
        entity("accepted", "manual"),
      ],
      excludedCategories: ["DATE"],
      notices: [],
    });

    expect(request.tokens).toEqual([
      { token: "[OSOBA_1]", category: "PERSON", occurrences: 2 },
      { token: "[PESEL_1]", category: "PESEL", occurrences: 1 },
    ]);
    expect([request.detected, request.rejected, request.manual]).toEqual([3, 1, 1]);
    expect(JSON.stringify(request)).not.toContain("Kowalski");
  });

  it("identifies the original by its SHA-256", async () => {
    // SHA-256 of "abc", the standard test vector.
    expect(await sha256Hex(new Blob(["abc"]))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
