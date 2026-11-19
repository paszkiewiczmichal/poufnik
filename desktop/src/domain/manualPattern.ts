// A phrase marked by hand must be found again elsewhere: in the same document right away
// and, saved as a custom rule, in every next one. The engine runs the same pattern with
// Python's `regex` module, so it uses only syntax both engines read alike.

// Polish case endings a name takes in a sentence: "Kowalski", "Kowalskiego", "Kowalską",
// "Warszawa", "Warszawie", "Nowak", "Nowakiem".
const ENDINGS = [
  "iego",
  "iemu",
  "owie",
  "ego",
  "emu",
  "iem",
  "owi",
  "ach",
  "ami",
  "imi",
  "ich",
  "iej",
  "ów",
  "ej",
  "em",
  "om",
  "im",
  "ie",
];
const SINGLE_LETTER_ENDINGS = "aeiouyąę";
const MIN_STEM_LENGTH = 3;
// Only capitalised words of letters are inflected: names, not common words or numbers.
const INFLECTABLE_WORD = /^\p{Lu}\p{L}{2,}$/u;
const BEFORE = "(?<![\\p{L}\\p{N}_])";
const AFTER = "(?![\\p{L}\\p{N}_])";

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pattern for a marked phrase, its capitalised form ("VITERRA POLSKA") and, with
 * `inflect`, the case forms of every capitalised word ("Viterry Polskiej").
 */
export function manualPhrasePattern(text: string, inflect = true): string {
  const phrase = text.trim();
  const variants = Array.from(new Set([phrase, phrase.toUpperCase()]));
  const body = variants.map((variant) => variantPattern(variant, inflect)).join("|");
  return `${BEFORE}(?:${body})${AFTER}`;
}

function variantPattern(phrase: string, inflect: boolean): string {
  return phrase
    .split(/\s+/)
    .map((word) =>
      inflect && INFLECTABLE_WORD.test(word)
        ? escapeRegex(stem(word)) + endingsGroup(word === word.toUpperCase())
        : escapeRegex(word),
    )
    .join("\\s+");
}

function stem(word: string): string {
  const lower = word.toLowerCase();
  const endings = [...ENDINGS, ...SINGLE_LETTER_ENDINGS];
  const ending = endings.find(
    (candidate) =>
      lower.endsWith(candidate) && word.length - candidate.length >= MIN_STEM_LENGTH,
  );
  return ending ? word.slice(0, word.length - ending.length) : word;
}

function endingsGroup(upper: boolean): string {
  const cased = (value: string) => (upper ? value.toUpperCase() : value);
  return `(?:${ENDINGS.map(cased).join("|")}|[${cased(SINGLE_LETTER_ENDINGS)}])?`;
}
