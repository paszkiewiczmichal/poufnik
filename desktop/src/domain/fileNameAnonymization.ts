import type { ReplacementMap } from "../types";

const MIN_VALUE_LENGTH = 3;
// Surnames in file names rarely share the document's grammatical form ("Umowa Kowalskiego"
// vs. "Janem Kowalskim"), so person words of this length also match by their stem.
const MIN_STEM_WORD_LENGTH = 7;
const STEM_CUT = 2;
const MAX_ENDING_DIFFERENCE = 3;

interface Rule {
  pattern: RegExp;
  token: string;
  weight: number;
}

/**
 * Replaces values from the document's replacement map in a file name (without extension)
 * by their tokens, so "Umowa Kowalski" becomes "Umowa [OSOBA_1]".
 */
export function anonymizeFileBaseName(
  base: string,
  replacementMap: ReplacementMap | null | undefined,
): string {
  if (!replacementMap) {
    return base;
  }
  const rules: Rule[] = [];
  for (const entry of replacementMap.entries) {
    const values = new Set(
      [entry.canonical_text, ...(entry.variants ?? [])].map((value) => value.replace(/\s+/g, " ").trim()),
    );
    for (const value of values) {
      if (value.length >= MIN_VALUE_LENGTH) {
        rules.push({ pattern: wholeValue(value), token: entry.token, weight: value.length });
      }
      if (entry.category !== "PERSON") {
        continue;
      }
      for (const word of value.split(" ")) {
        if (word.length >= MIN_STEM_WORD_LENGTH) {
          rules.push({ pattern: stemWord(word), token: entry.token, weight: word.length });
        } else if (word.length >= MIN_VALUE_LENGTH) {
          rules.push({ pattern: wholeValue(word), token: entry.token, weight: word.length });
        }
      }
    }
  }
  rules.sort((left, right) => right.weight - left.weight);

  // Tokens already placed are protected (as private-use markers) so a later, shorter rule
  // cannot touch them.
  const placed: string[] = [];
  let result = base;
  for (const rule of rules) {
    result = result.replace(rule.pattern, () => {
      placed.push(rule.token);
      return `${placed.length - 1}`;
    });
  }
  return result.replace(/(\d+)/g, (_match, index: string) => placed[Number(index)]);
}

const LETTER_OR_DIGIT = "\\p{L}\\p{N}";

function wholeValue(value: string): RegExp {
  // Words of the value may be joined by spaces, underscores, dots or dashes in a file name.
  const body = value
    .split(" ")
    .map(escapeRegExp)
    .join("[\\s_.-]+");
  return new RegExp(`(?<![${LETTER_OR_DIGIT}])${body}(?![${LETTER_OR_DIGIT}])`, "giu");
}

function stemWord(word: string): RegExp {
  const stem = escapeRegExp(word.slice(0, word.length - STEM_CUT));
  const ending = `[\\p{L}]{0,${STEM_CUT + MAX_ENDING_DIFFERENCE}}`;
  return new RegExp(`(?<![${LETTER_OR_DIGIT}])${stem}${ending}(?![${LETTER_OR_DIGIT}])`, "giu");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
