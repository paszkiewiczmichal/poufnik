import type { ReplacementMap } from "../types";
import { anonymizeFileBaseName } from "./fileNameAnonymization";

export interface BatchExportInput {
  filename: string;
  anonymizedText: string;
  replacementMap: ReplacementMap;
}

export interface BatchExportFile {
  filename: string;
  contents: string;
}

// Nazwa pliku wynikowego: nazwa oryginału (bez rozszerzenia) + "_poufnik", np.
// umowa.docx -> umowa_poufnik.docx, a mapa zastąpień -> umowa_poufnik_mapa.json.
// Dane z mapy zastąpień są w nazwie zamieniane na tokeny, tak jak w treści:
// "Umowa Kowalski.docx" -> "Umowa [OSOBA_1]_poufnik.docx".
export function poufnikFileName(
  sourceName: string | null | undefined,
  extension: string,
  kind: "result" | "map" = "result",
  replacementMap?: ReplacementMap | null,
): string {
  const base = anonymizeFileBaseName(safeBaseName(sourceName ?? ""), replacementMap);
  return withPoufnikSuffix(base, extension, kind);
}

function withPoufnikSuffix(base: string, extension: string, kind: "result" | "map"): string {
  return `${base}${kind === "map" ? "_poufnik_mapa" : "_poufnik"}.${extension}`;
}

export function batchExportFiles(items: BatchExportInput[]): BatchExportFile[] {
  const used = new Map<string, number>();
  return items.flatMap((item) => {
    const base = uniqueBaseName(
      anonymizeFileBaseName(safeBaseName(item.filename), item.replacementMap),
      used,
    );
    return [
      {
        filename: withPoufnikSuffix(base, "txt", "result"),
        contents: item.anonymizedText,
      },
      {
        filename: withPoufnikSuffix(base, "json", "map"),
        contents: JSON.stringify(item.replacementMap, null, 2),
      },
    ];
  });
}

function uniqueBaseName(base: string, used: Map<string, number>): string {
  const count = (used.get(base) ?? 0) + 1;
  used.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

function safeBaseName(filename: string): string {
  const withoutExtension = filename.replace(/\.[^./\\]+$/, "");
  const safe = Array.from(withoutExtension, (character) =>
    isUnsafeFilenameCharacter(character) ? "_" : character,
  )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return safe || "dokument";
}

function isUnsafeFilenameCharacter(character: string): boolean {
  return '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32;
}
