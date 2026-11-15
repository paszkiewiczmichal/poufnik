import { describe, expect, it } from "vitest";

import type { ReplacementMap } from "../types";
import {
  chooseReplacementMap,
  normalizedStem,
  parseReplacementMap,
  type MapCandidate,
} from "./mapLinking";

function map(fingerprint: string, values: Record<string, string>): ReplacementMap {
  return {
    document_fingerprint: fingerprint,
    entries: Object.entries(values).map(([token, canonical_text]) => ({
      token,
      category: token.slice(1, token.indexOf("_")),
      canonical_text,
    })),
  };
}

function candidate(
  replacementMap: ReplacementMap,
  names: Partial<Omit<MapCandidate, "map">> = {},
): MapCandidate {
  return {
    map: replacementMap,
    sourceName: null,
    outputName: null,
    mapFileName: null,
    savedAt: null,
    ...names,
  };
}

const kowalski = map("a", { "[OSOBA_1]": "Jan Kowalski", "[ADRES_1]": "ul. Lipowa 8" });
const nowak = map("b", { "[OSOBA_1]": "Anna Nowak", "[ADRES_1]": "ul. Długa 1" });

describe("chooseReplacementMap", () => {
  it("does not guess between maps that would put different people into the text", () => {
    const choice = chooseReplacementMap("odpowiedz.txt", "Pozew [OSOBA_1], [ADRES_1].", [
      candidate(nowak),
      candidate(kowalski),
    ]);

    expect(choice.kind).toBe("ambiguous");
    expect(choice.kind === "ambiguous" && choice.candidates.map((c) => c.map)).toEqual([
      nowak,
      kowalski,
    ]);
  });

  it("takes the map linked by the file name even when another one is newer", () => {
    const choice = chooseReplacementMap("umowa_poufnik_poprawiona.docx", "[OSOBA_1] podpisał.", [
      candidate(nowak, { outputName: "pozew_poufnik.docx" }),
      candidate(kowalski, { sourceName: "Umowa.docx", outputName: "umowa_poufnik.docx" }),
    ]);

    expect(choice).toEqual({ kind: "found", candidate: expect.objectContaining({ map: kowalski }) });
  });

  it("links a map file put next to the answer by its name", () => {
    const choice = chooseReplacementMap("umowa_poufnik_przywrocone (2).txt", "[OSOBA_1]", [
      candidate(nowak),
      candidate(kowalski, { mapFileName: "umowa_poufnik_mapa.json" }),
    ]);

    expect(choice.kind === "found" && choice.candidate.map).toBe(kowalski);
  });

  it("prefers the map that knows more of the tokens in the text", () => {
    const smaller = map("c", { "[OSOBA_1]": "Ewa Lis" });
    const choice = chooseReplacementMap("odpowiedz.md", "[OSOBA_1] i [ADRES_1]", [
      candidate(smaller),
      candidate(kowalski),
    ]);

    expect(choice.kind === "found" && choice.candidate.map).toBe(kowalski);
  });

  it("uses the newest of maps that would restore the text the same way", () => {
    const again = map("a2", { "[OSOBA_1]": "Jan Kowalski", "[ADRES_1]": "ul. Lipowa 8" });
    const choice = chooseReplacementMap("odpowiedz.md", "[OSOBA_1] z [ADRES_1]", [
      candidate(again),
      candidate(kowalski),
    ]);

    expect(choice.kind === "found" && choice.candidate.map).toBe(again);
  });

  it("finds nothing when no map knows a token from the text", () => {
    expect(chooseReplacementMap("a.txt", "[FIRMA_7] bez mapy", [candidate(kowalski)])).toEqual({
      kind: "none",
    });
    expect(chooseReplacementMap("a.txt", "bez oznaczeń", [candidate(kowalski)]).kind).toBe(
      "none",
    );
  });

  it("does not link by a name that merely shares a prefix", () => {
    const choice = chooseReplacementMap("umowakredytowa.txt", "[OSOBA_1] [ADRES_1]", [
      candidate(nowak),
      candidate(kowalski, { outputName: "umowa_poufnik.docx" }),
    ]);

    expect(choice.kind).toBe("ambiguous");
  });

  it("links the closest name, not a newer map whose original only starts the same way", () => {
    const choice = chooseReplacementMap("Umowa najmu_poufnik_ai.docx", "[OSOBA_1] [ADRES_1]", [
      candidate(kowalski, { sourceName: "Umowa.docx" }),
      candidate(nowak, { outputName: "Umowa najmu_poufnik.docx" }),
    ]);

    expect(choice.kind === "found" && choice.candidate.map).toBe(nowak);
  });

  it("does not guess between two linked maps of the same file name with different people", () => {
    const choice = chooseReplacementMap("Umowa_poufnik.docx", "[OSOBA_1] [ADRES_1]", [
      candidate(kowalski, { sourceName: "Umowa.docx" }),
      candidate(nowak, { sourceName: "Umowa.docx" }),
    ]);

    expect(choice.kind).toBe("ambiguous");
  });
});

describe("normalizedStem", () => {
  it("drops Poufnik's own suffixes, copy numbers and the extension", () => {
    expect(normalizedStem(String.raw`C:\Akta\Umowa_poufnik_przywrocone (2).docx`)).toBe("umowa");
    expect(normalizedStem("umowa_poufnik_mapa.json")).toBe("umowa");
    expect(normalizedStem("Pismo [OSOBA_1]_poufnik.pdf")).toBe("pismo [osoba_1]");
  });
});

describe("chooseReplacementMap in fictional-data mode", () => {
  function fakeMap(fingerprint: string, fake: string, original: string): ReplacementMap {
    return {
      document_fingerprint: fingerprint,
      entries: [
        {
          token: "[OSOBA_1]",
          category: "PERSON",
          canonical_text: original,
          fake_forms: { [fake]: original },
        },
      ],
    } as ReplacementMap;
  }

  it("finds the map by the invented values in the answer", () => {
    const own = fakeMap("a", "Adam Nowicki", "Jan Kowalski");
    const other = fakeMap("b", "Ewa Brzozowska", "Anna Nowak");

    const choice = chooseReplacementMap("odpowiedz.txt", "Adam Nowicki zapłaci.", [
      candidate(other),
      candidate(own),
    ]);

    expect(choice.kind === "found" && choice.candidate.map).toBe(own);
  });

  it("does not guess when two cases used the same invented name for different people", () => {
    const first = fakeMap("a", "Adam Nowicki", "Jan Kowalski");
    const second = fakeMap("b", "Adam Nowicki", "Piotr Lis");

    const choice = chooseReplacementMap("odpowiedz.txt", "Adam Nowicki zapłaci.", [
      candidate(first),
      candidate(second),
    ]);

    expect(choice.kind).toBe("ambiguous");
  });
});

describe("parseReplacementMap", () => {
  it("reads a bare map and a record remembered by Poufnik", () => {
    expect(parseReplacementMap(JSON.stringify(kowalski))).toEqual(kowalski);
    expect(parseReplacementMap(JSON.stringify({ version: 1, savedAt: 1, map: nowak }))).toEqual(nowak);
  });

  it.each(["{}", "[]", "nie json", JSON.stringify({ entries: [{ token: 1 }] })])(
    "refuses %s with a clear message",
    (json) => {
      expect(() => parseReplacementMap(json)).toThrow("To nie jest mapa zastąpień Poufnika.");
    },
  );
});
