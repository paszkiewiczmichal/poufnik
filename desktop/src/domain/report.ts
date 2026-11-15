import type { components } from "../api/openapi";
import type { DetectedEntity, OffsetMapEntry } from "../types";

export type ReportRequest = components["schemas"]["ReportRequest"];

/**
 * What the report for the case file says about one anonymization. Only tokens, categories,
 * counts and decisions: no value from the document ever goes into it (the engine refuses
 * anything that is not a token).
 */
export function buildReportRequest(input: {
  documentName: string;
  documentFormat: string;
  pageCount: number;
  sourceSha256: string | null;
  appVersion: string;
  offsetMap: OffsetMapEntry[];
  entities: DetectedEntity[];
  excludedCategories: string[];
  notices: string[];
  /** How the data was replaced, as the report states it. */
  mode?: string;
}): ReportRequest {
  const occurrences = new Map<string, { category: string; count: number }>();
  for (const entry of input.offsetMap) {
    // Fictional-data mode: ``token`` is the invented value, ``label`` the token behind it.
    const token = entry.label ?? entry.token;
    const known = occurrences.get(token);
    occurrences.set(token, {
      category: entry.category,
      count: (known?.count ?? 0) + 1,
    });
  }
  const proposed = input.entities.filter((entity) => entity.source !== "manual");
  return {
    document_name: input.documentName,
    document_format: input.documentFormat,
    page_count: input.pageCount,
    source_sha256: input.sourceSha256,
    app_version: input.appVersion || "nieznana",
    tokens: [...occurrences].map(([token, { category, count }]) => ({
      token,
      category,
      occurrences: count,
    })),
    detected: proposed.length,
    rejected: proposed.filter((entity) => entity.status === "rejected").length,
    manual: input.entities.length - proposed.length,
    excluded_categories: input.excludedCategories,
    notices: input.notices,
    mode: input.mode ?? "oznaczenia kategorii z numerem, np. [OSOBA_1]",
  };
}

/** SHA-256 of the original file, hex: identifies it in the case file without its content. */
export async function sha256Hex(file: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
