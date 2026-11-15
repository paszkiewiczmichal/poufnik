import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReplacementMap } from "../types";

// An in-memory folder and a fake "DPAPI": prefix + reversed bytes, so the stored file never
// contains the plaintext and a plaintext file is rejected as garbage.
const fs = vi.hoisted(() => ({ files: new Map<string, Uint8Array>() }));
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/path", () => ({
  appLocalDataDir: async () => "C:\\Data",
  join: async (...parts: string[]) => parts.join("\\"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: async () => undefined,
  readDir: async (directory: string) =>
    [...fs.files.keys()]
      .filter(
        (path) =>
          path.startsWith(`${directory}\\`) && !path.slice(directory.length + 1).includes("\\"),
      )
      .map((path) => ({
        name: path.slice(directory.length + 1),
        isFile: true,
        isDirectory: false,
      })),
  readFile: async (path: string) => fs.files.get(path)!,
  readTextFile: async (path: string) => new TextDecoder().decode(fs.files.get(path)!),
  writeFile: async (path: string, bytes: Uint8Array) => {
    fs.files.set(path, bytes);
  },
  remove: async (path: string) => {
    fs.files.delete(path);
  },
}));

import {
  deleteRememberedMaps,
  findReplacementMaps,
  loadRememberMaps,
  rememberReplacementMap,
  removeExpiredMaps,
  saveRememberMaps,
} from "./rememberedMaps";

const DIRECTORY = "C:\\Data\\menu-maps";
const MARK = new TextEncoder().encode("ENC:");
const DAY = 24 * 60 * 60 * 1000;

const MAP = {
  document_fingerprint: "abc",
  entries: [{ token: "[OSOBA_1]", category: "PERSON", canonical_text: "Jan Testowy" }],
} as unknown as ReplacementMap;

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function put(name: string, content: string): void {
  fs.files.set(`${DIRECTORY}\\${name}`, new TextEncoder().encode(content));
}

function names(): string[] {
  return [...fs.files.keys()].map((path) => path.split("\\").pop()!).sort();
}

beforeEach(() => {
  fs.files.clear();
  window.localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string, bytes: Uint8Array) => {
    if (command === "protect_map") {
      return new Uint8Array([...MARK, ...[...bytes].reverse()]).buffer;
    }
    if (command === "unprotect_map") {
      if (text(bytes.slice(0, 4)) !== "ENC:") {
        throw new Error("not protected");
      }
      return new Uint8Array([...bytes.slice(4)].reverse()).buffer;
    }
    throw new Error(`unexpected command ${command}`);
  });
});

describe("remembered replacement maps", () => {
  it("writes the map encrypted, never as plaintext", async () => {
    await rememberReplacementMap(MAP, {
      sourceName: "umowa.docx",
      outputName: "umowa_poufnik.docx",
    });

    const [[path, stored]] = [...fs.files.entries()];
    expect(path).toMatch(/menu-maps\\\d+-[0-9a-f]{8}\.pmap$/);
    expect(invokeMock.mock.calls.map((call) => call[0])).toEqual(["protect_map"]);
    expect(text(stored)).not.toContain("Jan Testowy");
    expect(text(stored)).not.toContain("umowa.docx");
  });

  it("finds an encrypted map again with its names", async () => {
    await rememberReplacementMap(MAP, {
      sourceName: "umowa.docx",
      outputName: "umowa_poufnik.docx",
    });

    const found = await findReplacementMaps(null);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      sourceName: "umowa.docx",
      outputName: "umowa_poufnik.docx",
      mapFileName: null,
    });
    expect(found[0].map.entries[0].canonical_text).toBe("Jan Testowy");
  });

  it("does not write plaintext when encryption fails", async () => {
    invokeMock.mockRejectedValue(new Error("DPAPI unavailable"));

    await expect(
      rememberReplacementMap(MAP, { sourceName: null, outputName: null }),
    ).rejects.toThrow();

    expect(fs.files.size).toBe(0);
  });

  it("still reads an old plaintext record and re-saves it encrypted", async () => {
    put(
      "1760000000000-abcd1234.json",
      JSON.stringify({ version: 1, savedAt: 1, sourceName: "stara.docx", outputName: null, map: MAP }),
    );

    const found = await findReplacementMaps(null);

    expect(found.map((candidate) => candidate.sourceName)).toEqual(["stara.docx"]);
    expect(names()).toEqual(["1760000000000-abcd1234.pmap"]);
    expect(text(fs.files.get(`${DIRECTORY}\\1760000000000-abcd1234.pmap`)!)).not.toContain(
      "Jan Testowy",
    );
    expect((await findReplacementMaps(null))[0].sourceName).toBe("stara.docx");
  });

  it("keeps a plaintext record when it cannot be encrypted, and still returns it", async () => {
    put(
      "1760000000000-abcd1234.json",
      JSON.stringify({ version: 1, savedAt: 1, sourceName: "stara.docx", outputName: null, map: MAP }),
    );
    invokeMock.mockRejectedValue(new Error("DPAPI unavailable"));

    const found = await findReplacementMaps(null);

    expect(found).toHaveLength(1);
    expect(names()).toEqual(["1760000000000-abcd1234.json"]);
  });

  it("skips a record that cannot be decrypted (another user)", async () => {
    put("1760000000000-abcd1234.pmap", "garbage");

    expect(await findReplacementMaps(null)).toEqual([]);
  });

  it("remembers nothing when the setting is off", async () => {
    saveRememberMaps(false);

    await rememberReplacementMap(MAP, { sourceName: null, outputName: null });

    expect(fs.files.size).toBe(0);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(loadRememberMaps()).toBe(false);
  });

  it("is on by default", () => {
    expect(loadRememberMaps()).toBe(true);
  });

  it("removes maps older than 30 days and keeps newer ones", async () => {
    const now = Date.now();
    put(`${now - 31 * DAY}-aaaaaaaa.pmap`, "x");
    put(`${now - 45 * DAY}-bbbbbbbb.json`, "x");
    put(`${now - 29 * DAY}-cccccccc.pmap`, "x");
    put(`${now - 1000}-dddddddd.pmap`, "x");

    expect(await removeExpiredMaps(now)).toBe(2);

    expect(names().map((name) => name.split("-")[1])).toEqual(["cccccccc.pmap", "dddddddd.pmap"]);
  });

  it("cleans up old maps when remembering a new one", async () => {
    put(`${Date.now() - 60 * DAY}-aaaaaaaa.pmap`, "x");

    await rememberReplacementMap(MAP, { sourceName: null, outputName: null });

    expect(names().some((name) => name.includes("aaaaaaaa"))).toBe(false);
    expect(fs.files.size).toBe(1);
  });

  it("deletes every remembered map and says how many", async () => {
    put("1-aaaaaaaa.pmap", "x");
    put("2-bbbbbbbb.json", "x");
    put("3-cccccccc.pmap", "x");

    expect(await deleteRememberedMaps()).toBe(3);
    expect(fs.files.size).toBe(0);
    expect(await deleteRememberedMaps()).toBe(0);
  });

  it("leaves maps the user saved next to a file alone", async () => {
    fs.files.set("C:\\Akta\\umowa_poufnik_mapa.json", new TextEncoder().encode("{}"));
    put("1-aaaaaaaa.pmap", "x");

    await deleteRememberedMaps();
    await removeExpiredMaps();

    expect(fs.files.has("C:\\Akta\\umowa_poufnik_mapa.json")).toBe(true);
  });
});
