import { describe, expect, it } from "vitest";

import { manualPhrasePattern } from "./manualPattern";

function matches(phrase: string, text: string, inflect = true): string[] {
  return [...text.matchAll(new RegExp(manualPhrasePattern(phrase, inflect), "gu"))].map(
    (match) => match[0],
  );
}

describe("manualPhrasePattern", () => {
  it("finds the case forms of a marked surname, also in capitals", () => {
    const text =
      "Kowalski podpisał. Umowa z Kowalskim, pismo do Kowalskiego, żona Kowalska. KOWALSKIEGO wezwano.";

    expect(matches("Kowalski", text)).toEqual([
      "Kowalski",
      "Kowalskim",
      "Kowalskiego",
      "Kowalska",
      "KOWALSKIEGO",
    ]);
  });

  it("does not catch a different word that only starts the same way", () => {
    expect(matches("Kowalski", "Kowalczyk i Kowalskiewicz oraz Kowalskich")).toEqual([
      "Kowalskich",
    ]);
    expect(matches("Nowak", "Nowakowski, Nowaka, Nowakiem")).toEqual(["Nowaka", "Nowakiem"]);
  });

  it("starts from the form that was marked, whatever its case", () => {
    expect(matches("Warszawie", "Warszawa, w Warszawie, do Warszawy, Warszawską")).toEqual([
      "Warszawa",
      "Warszawie",
      "Warszawy",
    ]);
  });

  it("inflects every capitalised word of a phrase and allows a line break between them", () => {
    const text = "Viterra Polska, spór z Viterry\nPolskiej, VITERRA POLSKA, Viterra Holding";

    expect(matches("Viterra Polska", text)).toEqual([
      "Viterra Polska",
      "Viterry\nPolskiej",
      "VITERRA POLSKA",
    ]);
  });

  it("leaves lowercase words, short words and numbers in their exact form", () => {
    expect(matches("bank", "bank, banku")).toEqual(["bank"]);
    expect(matches("MKO", "MKO, MKOS, 2023.MKO")).toEqual(["MKO", "MKO"]);
    expect(matches("Jan", "Jan, Jana, Janem, Janusz")).toEqual(["Jan", "Jana", "Janem"]);
  });

  it("keeps a lowercase word exact also in capitals", () => {
    expect(matches("wpisów", "wpisów, wpisu, WPISÓW, WPISU")).toEqual(["wpisów", "WPISÓW"]);
    expect(manualPhrasePattern("wpisów")).not.toContain("IEGO");
  });

  it("without inflection matches only the exact phrase and its capitals", () => {
    expect(matches("Kowalski", "Kowalski, Kowalskiego, KOWALSKI", false)).toEqual([
      "Kowalski",
      "KOWALSKI",
    ]);
  });

  it("escapes characters that mean something in a pattern", () => {
    expect(matches("Sp. z o.o.", "Sp. z o.o. oraz Spa z oxo.")).toEqual(["Sp. z o.o."]);
  });
});
