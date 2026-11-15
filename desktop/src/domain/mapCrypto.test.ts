import { describe, expect, it } from "vitest";

import type { ReplacementMap } from "../types";
import { decryptMap, encryptMap, isEncryptedMap, WrongMapPasswordError } from "./mapCrypto";

const MAP: ReplacementMap = {
  document_fingerprint: "abc",
  entries: [{ token: "[OSOBA_1]", category: "PERSON", canonical_text: "Jan Kowalski" }],
};

describe("encrypted replacement map", () => {
  it("round-trips with the right password and hides every value", async () => {
    const file = await encryptMap(MAP, "Tajne-Haslo-2026");

    expect(file).not.toContain("Kowalski");
    expect(file).not.toContain("OSOBA_1");
    expect(isEncryptedMap(file)).toBe(true);
    expect(await decryptMap(file, "Tajne-Haslo-2026")).toEqual(MAP);
  });

  it("refuses a wrong password and a tampered file", async () => {
    const file = await encryptMap(MAP, "Tajne-Haslo-2026");
    await expect(decryptMap(file, "tajne-haslo-2026")).rejects.toBeInstanceOf(WrongMapPasswordError);

    const tampered = JSON.parse(file);
    // Always a different first character (a fixed "A" would sometimes change nothing).
    const first = tampered.ciphertext[0] === "A" ? "B" : "A";
    tampered.ciphertext = `${first}${tampered.ciphertext.slice(1)}`;
    await expect(decryptMap(JSON.stringify(tampered), "Tajne-Haslo-2026")).rejects.toBeInstanceOf(
      WrongMapPasswordError,
    );
  });

  it("uses a fresh salt and IV each time and survives a large map", async () => {
    const big: ReplacementMap = {
      document_fingerprint: "big",
      entries: Array.from({ length: 3000 }, (_, index) => ({
        token: `[OSOBA_${index + 1}]`,
        category: "PERSON",
        canonical_text: `Osoba numer ${index + 1} z ulicy Długiej`,
      })),
    };
    const first = JSON.parse(await encryptMap(big, "x"));
    const second = JSON.parse(await encryptMap(big, "x"));

    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect((await decryptMap(JSON.stringify(first), "x")).entries).toHaveLength(3000);
  });

  it("refuses a file that asks for an absurd number of iterations", async () => {
    const file = JSON.parse(await encryptMap(MAP, "haslo"));
    file.iterations = 2_000_000_000;

    await expect(decryptMap(JSON.stringify(file), "haslo")).rejects.toBeInstanceOf(
      WrongMapPasswordError,
    );
  });

  it("answers a damaged file like a wrong password, not with a raw error", async () => {
    const file = JSON.parse(await encryptMap(MAP, "haslo"));
    file.salt = "%%% nie base64 %%%";

    await expect(decryptMap(JSON.stringify(file), "haslo")).rejects.toBeInstanceOf(
      WrongMapPasswordError,
    );
    await expect(decryptMap("{uszkodzony", "haslo")).rejects.toBeInstanceOf(WrongMapPasswordError);
  });

  it("accepts the same password typed in another Unicode form", async () => {
    const encrypted = await encryptMap(MAP, "Zażółć");

    const map = await decryptMap(encrypted, "Zażółć".normalize("NFD"));

    expect(map.entries[0].canonical_text).toBe("Jan Kowalski");
  });

  it("tells a plain JSON map from an encrypted one", () => {
    expect(isEncryptedMap(JSON.stringify(MAP))).toBe(false);
    expect(isEncryptedMap("nie json")).toBe(false);
  });
});
