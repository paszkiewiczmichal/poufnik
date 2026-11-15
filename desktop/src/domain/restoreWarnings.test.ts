import { describe, expect, it } from "vitest";

import { texts } from "../i18n";
import type { ReplacementMap } from "../types";
import {
  findUnrestorableTokens,
  restoreWarningMessage,
  tokensFromEngineWarnings,
} from "./restoreWarnings";

const MAP = {
  document_fingerprint: "x",
  entries: [{ token: "[OSOBA_1]", category: "PERSON", canonical_text: "Jan Testowy" }],
} as unknown as ReplacementMap;

describe("restore warnings", () => {
  it("reads tokens out of the engine's warnings", () => {
    expect(
      tokensFromEngineWarnings([
        "Unknown anonymization token [OSOBA_7] at offset 5.",
        "... and 3 more.",
      ]),
    ).toEqual(["[OSOBA_7]"]);
  });

  it("finds unknown and mangled tokens, not known ones or ordinary brackets", () => {
    const text = "[OSOBA_1], [OSOBA_7], [OSOBA 1], [Osoba_1], [osoba-1], [art. 5], [PKT 3a]";

    expect(findUnrestorableTokens(text, MAP)).toEqual([
      "[OSOBA_7]",
      "[OSOBA 1]",
      "[Osoba_1]",
      "[osoba-1]",
    ]);
  });

  it("returns null when nothing is left", () => {
    expect(restoreWarningMessage("[OSOBA_1] zapłaci.", MAP, [])).toBeNull();
  });

  it("builds the plain Polish message with the count", () => {
    expect(restoreWarningMessage("[OSOBA_7] i [OSOBA 1]", MAP, [], "file")).toBe(
      "W pliku zostały 2 oznaczenia, których nie ma w mapie: [OSOBA_7], [OSOBA 1]. Sprawdź je ręcznie.",
    );
    expect(restoreWarningMessage("[OSOBA_7]", MAP, [], "text")).toBe(
      "W tekście zostało 1 oznaczenie, którego nie ma w mapie: [OSOBA_7]. Sprawdź je ręcznie.",
    );
  });

  it("does not repeat a token reported by both the engine and the app", () => {
    const message = restoreWarningMessage("[OSOBA_7]", MAP, [
      "Unknown anonymization token [OSOBA_7] at offset 0.",
    ]);

    expect(message).toBe(texts.restoreWarnings.unknownTokens(["[OSOBA_7]"], "file"));
  });

  it("uses the right plural form and shortens a long list", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `[X_${i}]`);
    expect(texts.restoreWarnings.unknownTokens(many(5), "file")).toContain("zostało 5 oznaczeń");
    expect(texts.restoreWarnings.unknownTokens(many(12), "file")).toContain("zostało 12 oznaczeń");
    expect(texts.restoreWarnings.unknownTokens(many(22), "file")).toContain("zostały 22 oznaczenia");
    expect(texts.restoreWarnings.unknownTokens(many(12), "file")).toContain("i 2 kolejnych");
  });
});
