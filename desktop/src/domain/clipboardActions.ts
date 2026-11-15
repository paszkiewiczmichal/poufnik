import type { AnonymizerApiClient } from "../api/client";
import type { CustomRegexRulePayload } from "../types";
import type { ApiDetectedEntity, EntityCategory, ReplacementMap } from "../types";
import { chooseReplacementMap, type MapCandidate } from "./mapLinking";
import { restoreWarningMessage } from "./restoreWarnings";

/**
 * Keyboard shortcuts working in any program (Ctrl+Alt+Shift+P / R): the user copies a
 * fragment, Poufnik puts the anonymized version - or, for an AI answer, the restored one -
 * back on the clipboard, ready to paste. Nothing is typed into other programs.
 */
export interface ClipboardDeps {
  client: AnonymizerApiClient;
  readText: () => Promise<string>;
  writeText: (text: string) => Promise<void>;
  excludedCategories: EntityCategory[];
  /** The account's own rules, as in the window: the shortcut must not protect less. */
  customRules: CustomRegexRulePayload[];
  rememberMap: (
    map: ReplacementMap,
    names: { sourceName: string | null; outputName: string | null },
  ) => Promise<void>;
  findMaps: () => Promise<MapCandidate[]>;
}

export type ClipboardOutcome =
  | { ok: true; replaced: number; warning?: string | null }
  | { ok: false; reason: "empty" | "nothing_found" | "no_map" | "ambiguous_map" };

export async function anonymizeClipboard(deps: ClipboardDeps): Promise<ClipboardOutcome> {
  const text = await deps.readText();
  if (!text.trim()) {
    return { ok: false, reason: "empty" };
  }
  const detected = (await deps.client.analyze(text, deps.customRules)).entities as ApiDetectedEntity[];
  const entities = detected.map((entity) =>
    deps.excludedCategories.includes(entity.category as EntityCategory)
      ? { ...entity, status: "rejected" as const }
      : entity,
  );
  const result = await deps.client.anonymizeApiEntities(text, entities);
  const replaced = result.offset_map?.length ?? 0;
  if (replaced === 0) {
    return { ok: false, reason: "nothing_found" };
  }
  // The map first: anonymized text on the clipboard without a map could never be restored.
  await deps.rememberMap(result.replacement_map, { sourceName: null, outputName: null });
  await deps.writeText(result.anonymized_text);
  return { ok: true, replaced };
}

export async function restoreClipboard(deps: ClipboardDeps): Promise<ClipboardOutcome> {
  const text = await deps.readText();
  if (!text.trim()) {
    return { ok: false, reason: "empty" };
  }
  const choice = chooseReplacementMap("", text, await deps.findMaps());
  if (choice.kind === "none") {
    return { ok: false, reason: "no_map" };
  }
  if (choice.kind === "ambiguous") {
    // Several cases use these tokens with different data: never guess whose data to put back.
    return { ok: false, reason: "ambiguous_map" };
  }
  const restored = await deps.client.deanonymize(text, choice.candidate.map);
  await deps.writeText(restored.original_text);
  const warning = restoreWarningMessage(
    text,
    choice.candidate.map,
    restored.warnings ?? [],
    "text",
  );
  return { ok: true, replaced: choice.candidate.map.entries.length, warning };
}
