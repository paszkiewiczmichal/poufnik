import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DESKTOP_ROOT = process.cwd();
const UPDATE_MANIFEST_URL =
  "https://github.com/paszkiewiczmichal/poufnik/releases/latest/download/latest.json";
const ACCOUNTS_BASE_URL = "https://account.lawtern.com";

describe("desktop offline guard", () => {
  const allowedFetchFiles = new Set(["src/api/client.ts", "src/auth/client.ts"]);

  it("keeps Tauri CSP restricted to local engine and update manifest", () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(DESKTOP_ROOT, "src-tauri", "tauri.conf.json"), "utf-8"),
    );

    expect(config.app.security.csp).toEqual({
      "default-src": "'self'",
      "script-src": "'self'",
      "style-src": "'self'",
      "img-src": "'self' data:",
      "connect-src": [
        "'self'",
        "ipc:",
        "http://ipc.localhost",
        "http://127.0.0.1:*",
        ACCOUNTS_BASE_URL,
        UPDATE_MANIFEST_URL,
      ].join(" "),
    });
  });

  it("does not use browser network APIs outside the local engine client", () => {
    // Jedyne dopuszczone zewnętrzne URL-e: dwa linki informacyjne w stopce (kancelaria,
    // lawtern.com - decyzja Michała 2026-08-09), otwierane wyłącznie świadomym kliknięciem
    // przez tauri/external.ts (przeglądarka systemowa, nie fetch w aplikacji) - decyzja
    // Michała, prompt domknięcia layoutu Gabinet 2026-07-11, pkt 1; oraz serwis kont
    // (account.lawtern.com) w src/auth/client.ts - jedyny dozwolony fetch-owy backend
    // logowania, potwierdzony 2026-09-04 (CORS naprawiony po stronie account.lawtern.com
    // dla originów tauri://localhost / http://tauri.localhost). Każdy inny URL nadal jest
    // naruszeniem.
    const allowedExternalUrls = new Map([
      ["src/i18n.ts", new Set(["https://www.kancelariapaszkiewicz.pl", "https://www.lawtern.com"])],
      ["src/auth/client.ts", new Set([ACCOUNTS_BASE_URL])],
    ]);

    const offenders: string[] = [];
    for (const filePath of sourceFiles(path.join(DESKTOP_ROOT, "src"))) {
      const relative = slash(path.relative(DESKTOP_ROOT, filePath));
      if (relative.endsWith(".test.ts") || relative === "src/api/openapi.ts") {
        continue;
      }
      const contents = fs.readFileSync(filePath, "utf-8");
      if (/\bfetch\s*\(/.test(contents) && !allowedFetchFiles.has(relative)) {
        offenders.push(`${relative}: fetch`);
      }
      if (/\bXMLHttpRequest\b|\bnavigator\.sendBeacon\b|\bWebSocket\b|\bEventSource\b/.test(contents)) {
        offenders.push(`${relative}: browser network primitive`);
      }
      for (const url of contents.matchAll(/https?:\/\/[^\s"'`),}]+/g)) {
        if (allowedExternalUrls.get(relative)?.has(url[0])) {
          continue;
        }
        if (!url[0].startsWith("http://127.0.0.1")) {
          offenders.push(`${relative}: ${url[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps document processing modules independent from account auth", () => {
    const guardedRoots = [
      path.join(DESKTOP_ROOT, "src", "api"),
      path.join(DESKTOP_ROOT, "src", "domain"),
      path.join(DESKTOP_ROOT, "src", "tauri"),
    ];
    const guardedFiles = guardedRoots.flatMap((root) => [...sourceFiles(root)]);
    guardedFiles.push(
      path.join(DESKTOP_ROOT, "src", "components", "DocumentWorkspace.tsx"),
      path.join(DESKTOP_ROOT, "src", "components", "DocumentView.tsx"),
      path.join(DESKTOP_ROOT, "src", "components", "StartScreen.tsx"),
      path.join(DESKTOP_ROOT, "src", "store", "useAppStore.ts"),
    );

    const offenders = guardedFiles
      .map((filePath) => ({
        relative: slash(path.relative(DESKTOP_ROOT, filePath)),
        contents: fs.readFileSync(filePath, "utf-8"),
      }))
      .filter(({ relative }) => relative !== "src/auth/client.ts")
      .filter(({ contents }) => /["']\.\.\/auth\/|["']\.\/auth\//.test(contents))
      .map(({ relative }) => relative);

    expect(offenders).toEqual([]);
  });

  it("does not add Rust HTTP clients outside official Tauri internals/updater config", () => {
    const offenders: string[] = [];
    const rustFiles = [
      ...sourceFiles(path.join(DESKTOP_ROOT, "src-tauri", "src")),
      path.join(DESKTOP_ROOT, "src-tauri", "Cargo.toml"),
    ];
    for (const filePath of rustFiles) {
      const relative = slash(path.relative(DESKTOP_ROOT, filePath));
      const contents = fs.readFileSync(filePath, "utf-8");
      if (/\breqwest\b|\bureq\b|\bisahc\b|\bsurf\b/.test(contents)) {
        offenders.push(relative);
      }
      for (const url of contents.matchAll(/https?:\/\/[^\s"'`),}]+/g)) {
        if (!url[0].startsWith("http://127.0.0.1")) {
          offenders.push(`${relative}: ${url[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

function* sourceFiles(root: string): Generator<string> {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(fullPath);
      continue;
    }
    if (/\.(ts|tsx|rs|toml|json)$/.test(entry.name)) {
      yield fullPath;
    }
  }
}

function slash(value: string): string {
  return value.replaceAll(path.sep, "/");
}
