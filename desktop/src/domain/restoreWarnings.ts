import { texts } from "../i18n";
import type { ReplacementMap } from "../types";
import { TOKEN_PATTERN } from "./deanonymization";

// A token an AI mangled: "[OSOBA 1]", "[OSOBA-1]" (capitals only, so "[art. 5]" stays quiet).
const MANGLED_TOKEN = /\[[A-ZĄĆĘŁŃÓŚŹŻ]{2,}(?:[ _-][A-ZĄĆĘŁŃÓŚŹŻ]+)*[ -]\d+\]/g;
// What the engine says about an unknown token: "Unknown anonymization token [OSOBA_7] at offset 5."
const ENGINE_TOKEN = /token (\[[^\]]+\])/;

/** Tokens the engine reported as missing from the map (X-Poufnik-Warnings / `warnings`). */
export function tokensFromEngineWarnings(warnings: readonly string[]): string[] {
  return warnings.flatMap((warning) => {
    const token = ENGINE_TOKEN.exec(warning)?.[1];
    return token ? [token] : [];
  });
}

/**
 * Token-like leftovers in `text` that the map cannot restore: well-formed tokens the map does
 * not know ("[OSOBA_7]") and mangled ones ("[OSOBA 1]", "[osoba_1]" when the map has OSOBA).
 */
export function findUnrestorableTokens(text: string, map: ReplacementMap): string[] {
  const known = new Set(map.entries.map((entry) => entry.token));
  const prefixes = new Set(
    [...known].map((token) => token.replace(/^\[|[_ ]?\d+\]$/g, "").toUpperCase()),
  );
  const found = new Set<string>();
  for (const token of text.match(TOKEN_PATTERN) ?? []) {
    found.add(token);
  }
  for (const token of text.match(MANGLED_TOKEN) ?? []) {
    found.add(token);
  }
  // Lower-case or mixed-case variants of a category the map really has: "[Osoba_1]".
  for (const token of text.match(/\[[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+(?:[ _-][A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+)*[ _-]\d+\]/g) ?? []) {
    const prefix = token.slice(1, -1).replace(/[ _-]\d+$/, "").replace(/[ -]/g, "_").toUpperCase();
    if (prefixes.has(prefix)) {
      found.add(token);
    }
  }
  return [...found].filter((token) => !known.has(token));
}

/**
 * One plain-Polish warning for a restore, or null when nothing is left unrestored. Merges
 * what the engine reported with what the app finds in the source text itself.
 */
export function restoreWarningMessage(
  sourceText: string,
  map: ReplacementMap,
  engineWarnings: readonly string[] = [],
  subject: "file" | "text" = "file",
): string | null {
  const tokens = [
    ...new Set([...tokensFromEngineWarnings(engineWarnings), ...findUnrestorableTokens(sourceText, map)]),
  ];
  return tokens.length > 0 ? texts.restoreWarnings.unknownTokens(tokens, subject) : null;
}
