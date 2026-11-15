import type { ReplacementMap } from "../types";
import { TOKEN_PATTERN } from "./deanonymization";

/**
 * A replacement map Poufnik can use to restore a file that came back from an AI chat, with
 * what links it to that file. Maps are remembered after every anonymization (window, batch,
 * context menu); a map file the user put next to the restored file counts too.
 */
export interface MapCandidate {
  map: ReplacementMap;
  /** Name of the original document, e.g. "Umowa Kowalski.docx" (unknown for older maps). */
  sourceName: string | null;
  /** Name of the anonymized file, e.g. "Umowa [OSOBA_1]_poufnik.docx". */
  outputName: string | null;
  /** A "…_poufnik_mapa.json" file next to the restored file, or one the user loaded. */
  mapFileName: string | null;
  /** When the map was remembered (ms), for showing and for newest-first order. */
  savedAt: number | null;
}

/**
 * A map file chosen by the user: either a bare map or a record remembered by Poufnik
 * ({version, map, ...}). Anything else is refused with a clear message instead of breaking
 * the window later.
 */
export function parseReplacementMap(json: string): ReplacementMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(NOT_A_MAP);
  }
  const candidate =
    parsed && typeof parsed === "object" && "map" in parsed ? (parsed as { map: unknown }).map : parsed;
  if (!isReplacementMap(candidate)) {
    throw new Error(NOT_A_MAP);
  }
  return candidate;
}

const NOT_A_MAP = "To nie jest mapa zastąpień Poufnika.";

function isReplacementMap(value: unknown): value is ReplacementMap {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entries = (value as { entries?: unknown }).entries;
  return (
    Array.isArray(entries) &&
    entries.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as { token?: unknown }).token === "string" &&
        typeof (entry as { canonical_text?: unknown }).canonical_text === "string" &&
        typeof (entry as { category?: unknown }).category === "string",
    )
  );
}

export type MapChoice =
  | { kind: "found"; candidate: MapCandidate }
  | { kind: "ambiguous"; candidates: MapCandidate[] }
  | { kind: "none" };

/**
 * Picks the map for `fileName` with the text `text`. `candidates` come newest first.
 *
 * 1. Only maps with at least one of their tokens in the text are considered.
 * 2. A map linked by name wins: the file is called like the anonymized file, the original or
 *    the map file (e.g. "umowa_poufnik_poprawiona.docx" for "umowa_poufnik.docx"). The
 *    closest name counts: the same name before a longer prefix before a shorter one, so
 *    "Umowa najmu_poufnik_ai" goes with "Umowa najmu", not with "Umowa".
 * 3. Otherwise the map with the most of its tokens in the text.
 * 4. When several maps tie (in 2 or 3) and would put different data back, Poufnik does not guess: the
 *    choice goes to the user. Tokens like [OSOBA_1] are in almost every map, so a wrong guess
 *    would put another client's data into the document.
 */
export function chooseReplacementMap(
  fileName: string,
  text: string,
  candidates: MapCandidate[],
): MapChoice {
  const tokens = new Set(text.match(TOKEN_PATTERN) ?? []);
  const scored = candidates
    .map((candidate) => ({ candidate, score: tokenScore(candidate.map, tokens, text) }))
    .filter(({ score }) => score > 0);
  if (scored.length === 0) {
    return { kind: "none" };
  }

  const strengths = scored.map(({ candidate }) => linkStrength(fileName, candidate));
  const strongest = Math.max(...strengths);
  if (strongest > 0) {
    return pick(
      scored.filter((_, index) => strengths[index] === strongest).map(({ candidate }) => candidate),
      tokens,
      text,
    );
  }

  const best = Math.max(...scored.map(({ score }) => score));
  return pick(
    scored.filter(({ score }) => score === best).map(({ candidate }) => candidate),
    tokens,
    text,
  );
}

function pick(tied: MapCandidate[], tokens: Set<string>, text: string): MapChoice {
  const distinct = withDistinctRestorations(tied, tokens, text);
  if (distinct.length === 1) {
    return { kind: "found", candidate: tied[0] };
  }
  return { kind: "ambiguous", candidates: distinct };
}

function tokenScore(map: ReplacementMap, tokens: Set<string>, text: string): number {
  return new Set(
    map.entries
      .filter(
        (entry) =>
          tokens.has(entry.token) ||
          // Fictional-data mode: the text holds invented values, not tokens.
          Object.keys(entry.fake_forms ?? {}).some((form) => text.includes(form)),
      )
      .map((entry) => entry.token),
  ).size;
}

/** Keeps one candidate per different result: maps that restore the text the same way are one. */
function withDistinctRestorations(
  candidates: MapCandidate[],
  tokens: Set<string>,
  text: string,
): MapCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const restoredTokens = [...tokens].map((token) => [
      token,
      candidate.map.entries.find((entry) => entry.token === token)?.canonical_text ?? null,
    ]);
    // Fictional-data mode: what each invented value present in the text turns back into.
    const restoredForms = candidate.map.entries
      .flatMap((entry) => Object.entries(entry.fake_forms ?? {}))
      .filter(([form]) => text.includes(form))
      .sort(([left], [right]) => left.localeCompare(right));
    const key = JSON.stringify([restoredTokens, restoredForms]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** 0 = not linked; the same name beats any prefix; a longer prefix beats a shorter one. */
function linkStrength(fileName: string, candidate: MapCandidate): number {
  const file = normalizedStem(fileName);
  let strength = 0;
  for (const name of [candidate.outputName, candidate.sourceName, candidate.mapFileName]) {
    const linked = name ? normalizedStem(name) : "";
    if (linked.length < 3) {
      continue;
    }
    if (file === linked) {
      strength = Math.max(strength, 1_000_000 + linked.length);
    } else if (file.startsWith(`${linked}_`) || file.startsWith(`${linked} `)) {
      strength = Math.max(strength, linked.length);
    }
  }
  return strength;
}

/** "Umowa_poufnik_przywrocone (2).docx" -> "umowa"; "umowa_poufnik_mapa.json" -> "umowa". */
export function normalizedStem(name: string): string {
  let stem = (name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, "").toLowerCase().trim();
  stem = stem.replace(/ \(\d+\)$/, "");
  for (const suffix of ["_przywrocone", "_poufnik_mapa", "_poufnik"]) {
    if (stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length);
    }
  }
  return stem;
}
