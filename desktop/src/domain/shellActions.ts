import type { AnonymizerApiClient, ExportedBlob } from "../api/client";
import { fallbackOnEngineRefusal } from "../api/errors";
import { texts } from "../i18n";
import type { DocumentProcessResponse, ExportFormat, ReplacementMap } from "../types";
import {
  buildAnonymizedExport,
  buildOwnFormatExport,
  ownExportFormat,
  type AnonymizedExportPlatform,
} from "./anonymizedExport";
import { poufnikFileName } from "./batchExport";
import { chooseReplacementMap, type MapCandidate } from "./mapLinking";
import { restoreWarningMessage } from "./restoreWarnings";
import { blocksForExport } from "./documentSegments";

// Actions behind the Explorer context menu (right click on a file → Poufnik → …).
export type ShellAction = "anonymize" | "ocr" | "markdown" | "restore" | "metadata";

export interface ShellActionRequest {
  action: ShellAction;
  paths: string[];
}

export interface ShellActionDeps {
  client: AnonymizerApiClient;
  readDocument: (path: string) => Promise<File>;
  readText: (path: string) => Promise<string>;
  /** Writes a new file; never called for a path that `exists` reports. */
  writeFile: (path: string, contents: Blob | string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  copyText: (text: string) => Promise<void>;
  /** Custom rules and excluded categories, exactly as for a document opened in the window. */
  applyUserSettings: (
    client: AnonymizerApiClient,
    response: DocumentProcessResponse,
  ) => Promise<DocumentProcessResponse>;
  exportPlatform: AnonymizedExportPlatform;
  /** Keeps the map so "Przywróć dane" can find it later. */
  rememberMap: (
    map: ReplacementMap,
    names: { sourceName: string | null; outputName: string | null },
  ) => Promise<void>;
  /** Candidate maps for restoring, newest first. */
  findMaps: (inputPath: string) => Promise<MapCandidate[]>;
}

export type ShellActionOutcome =
  | { ok: true; outputPath: string; copied: boolean; notice: string | null }
  | { ok: false; reason: "no_map" | "ambiguous_map" | "unsupported" | "error"; message?: string };

const RESTORABLE_EXTENSIONS = ["txt", "md", "docx", "xlsx", "pdf"];
// The same list as the Explorer menu (desktop/shell-menu/src/lib.rs, hooks.nsh).
export const CLEANABLE_EXTENSIONS = [
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "odt",
  "ods",
  "odp",
  "png",
  "jpg",
  "jpeg",
  "jpe",
  "heic",
  "heif",
  "tif",
  "tiff",
];

export async function runShellAction(
  action: ShellAction,
  path: string,
  deps: ShellActionDeps,
): Promise<ShellActionOutcome> {
  switch (action) {
    case "anonymize":
      return anonymizeFile(path, deps);
    case "ocr":
      return ocrFile(path, deps);
    case "markdown":
      return markdownFile(path, deps);
    case "restore":
      return restoreFile(path, deps);
    case "metadata":
      return cleanMetadataFile(path, deps);
  }
}

async function processWithSettings(path: string, deps: ShellActionDeps) {
  const file = await deps.readDocument(path);
  const response = await deps.applyUserSettings(
    deps.client,
    await deps.client.processDocument(file, { forceOcr: false }),
  );
  return { file, response };
}

async function anonymizeFile(path: string, deps: ShellActionDeps): Promise<ShellActionOutcome> {
  const { file, response } = await processWithSettings(path, deps);
  const extension = extensionOf(file.name);
  const map = response.replacement_map;
  await deps.rememberMap(map, {
    sourceName: file.name,
    outputName: poufnikFileName(file.name, extension || "pdf", "result", map),
  });
  if (extension === "txt") {
    const output = await freePath(deps, path, poufnikFileName(file.name, "txt", "result", map));
    await deps.writeFile(output, response.anonymized_text);
    return { ok: true, outputPath: output, copied: false, notice: null };
  }
  const source = {
    document: response.document,
    sourceFile: file,
    anonymizedText: response.anonymized_text,
    offsetMap: response.offset_map ?? [],
  };
  if (ownExportFormat(response.document)) {
    // Spreadsheets, presentations, OpenDocument files and photos keep their own format.
    const { blob, notice, extension: saved } = await buildOwnFormatExport(deps.client, source);
    const output = await freePath(deps, path, poufnikFileName(file.name, saved, "result", map));
    await deps.writeFile(output, blob);
    return { ok: true, outputPath: output, copied: false, notice };
  }
  const format: ExportFormat = extension === "docx" ? "docx" : "pdf";
  const { blob, notice } = await buildAnonymizedExport(
    deps.client,
    source,
    format,
    deps.exportPlatform,
  );
  const output = await freePath(deps, path, poufnikFileName(file.name, format, "result", map));
  await deps.writeFile(output, blob);
  return { ok: true, outputPath: output, copied: false, notice };
}

// Raw text, nothing anonymized: for copying the text out of a scan.
async function ocrFile(path: string, deps: ShellActionDeps): Promise<ShellActionOutcome> {
  const file = await deps.readDocument(path);
  const response = await deps.client.processDocument(file, { forceOcr: false });
  const text = response.document.text;
  const output = await freePath(deps, path, `${baseName(file.name)}_tekst.txt`);
  await deps.writeFile(output, text);
  await deps.copyText(text);
  return { ok: true, outputPath: output, copied: true, notice: null };
}

// Anonymized text for pasting into an AI chat: saved as .md and put on the clipboard.
async function markdownFile(path: string, deps: ShellActionDeps): Promise<ShellActionOutcome> {
  const { file, response } = await processWithSettings(path, deps);
  const map = response.replacement_map;
  const outputName = poufnikFileName(file.name, "md", "result", map);
  await deps.rememberMap(map, { sourceName: file.name, outputName });
  const output = await freePath(deps, path, outputName);
  await deps.writeFile(output, response.anonymized_text);
  await deps.copyText(response.anonymized_text);
  return { ok: true, outputPath: output, copied: true, notice: null };
}

// Puts the original values back into a file that came back from an AI chat, in the same
// format. The map is the one whose tokens occur in the file (the window passes its own).
async function restoreFile(path: string, deps: ShellActionDeps): Promise<ShellActionOutcome> {
  const name = filenameOf(path);
  const extension = extensionOf(name);
  if (!RESTORABLE_EXTENSIONS.includes(extension)) {
    return { ok: false, reason: "unsupported" };
  }
  const file = extension === "txt" || extension === "md" ? null : await deps.readDocument(path);
  const text = file
    ? (await deps.client.processDocument(file, { forceOcr: false })).document.text
    : await deps.readText(path);
  const choice = chooseReplacementMap(name, text, await deps.findMaps(path));
  if (choice.kind === "none") {
    return { ok: false, reason: "no_map" };
  }
  if (choice.kind === "ambiguous") {
    // Several maps fit and would put different data back: the window shows the choice.
    return { ok: false, reason: "ambiguous_map" };
  }
  const map = choice.candidate.map;
  const { contents, notice } = await restoreFileContents(deps.client, {
    name,
    file,
    text,
    map,
  });
  const output = await freePath(deps, path, restoredFileName(name));
  await deps.writeFile(output, contents);
  return { ok: true, outputPath: output, copied: false, notice };
}

export const RESTORABLE_FILE_EXTENSIONS: readonly string[] = RESTORABLE_EXTENSIONS;

export function isRestorableFileName(name: string): boolean {
  return RESTORABLE_EXTENSIONS.includes(extensionOf(name));
}

/** umowa_poufnik.docx -> umowa_poufnik_przywrocone.docx */
export function restoredFileName(name: string): string {
  return `${baseName(name)}_przywrocone.${extensionOf(name)}`;
}

/** The text of a file that came back from an AI chat: TXT/MD as they are, DOCX/PDF read by the engine. */
export async function restorableText(client: AnonymizerApiClient, file: File): Promise<string> {
  const extension = extensionOf(file.name);
  if (extension === "txt" || extension === "md") {
    return file.text();
  }
  return (await client.processDocument(file, { forceOcr: false })).document.text;
}

/**
 * The file with the original values back, in its own format: TXT/MD as text, DOCX edited in
 * place (layout, tracked changes and comments kept; a simple DOCX when the engine refuses),
 * PDF rebuilt as a simple PDF from the restored text. Used by the menu and by the window.
 */
export async function restoreFileContents(
  client: AnonymizerApiClient,
  source: { name: string; file: File | null; text: string; map: ReplacementMap },
): Promise<{ contents: Blob | string; notice: string | null }> {
  const extension = extensionOf(source.name);
  const notices: string[] = [];
  // What the engine reported as left in the file (missing from the map).
  const engineWarnings: string[] = [];
  const restoredText = async () => {
    const response = await client.deanonymize(source.text, source.map);
    engineWarnings.push(...(response.warnings ?? []));
    return response.original_text;
  };
  const simpleExport = async (format: ExportFormat) => {
    const restored = await restoredText();
    return client.exportDocument({
      anonymizedText: restored,
      format,
      blocks: blocksForExport(restored),
    });
  };
  let contents: Blob | string;
  if (extension === "docx" && source.file) {
    const inPlace = await client
      .restoreDocxInPlace({ file: source.file, replacementMap: source.map })
      .catch(fallbackOnEngineRefusal);
    if (inPlace) {
      contents = inPlace;
      engineWarnings.push(...((inPlace as ExportedBlob).warnings ?? []));
    } else {
      contents = await simpleExport("docx");
      notices.push(texts.shellActions.restoredSimplified);
    }
  } else if (extension === "xlsx" && source.file) {
    // No simpler fallback: a spreadsheet rebuilt from text would lose its cells.
    const inPlace = await client.restoreDocxInPlace({
      file: source.file,
      replacementMap: source.map,
      kind: "xlsx",
    });
    contents = inPlace;
    engineWarnings.push(...(inPlace.warnings ?? []));
  } else if (extension === "pdf") {
    contents = await simpleExport("pdf");
    notices.push(texts.shellActions.restoredPdfSimplified);
  } else {
    contents = await restoredText();
  }
  const warning = restoreWarningMessage(source.text, source.map, engineWarnings, "file");
  if (warning) {
    notices.push(warning);
  }
  return { contents, notice: notices.length > 0 ? notices.join(" ") : null };
}

// Same file without metadata (authors, dates, paths, thumbnails, EXIF/GPS...). Nothing is
// anonymized and the original is never overwritten.
async function cleanMetadataFile(
  path: string,
  deps: ShellActionDeps,
): Promise<ShellActionOutcome> {
  const name = filenameOf(path);
  const extension = extensionOf(name);
  if (!CLEANABLE_EXTENSIONS.includes(extension)) {
    return { ok: false, reason: "unsupported" };
  }
  const { blob, removed, notices } = await deps.client.cleanMetadata(await deps.readDocument(path));
  const output = await freePath(deps, path, `${baseName(name)}_bez_metadanych.${extension}`);
  await deps.writeFile(output, blob);
  const parts = [texts.shellActions.metadataRemoved(removed)];
  if (notices.includes("signature_invalidated")) {
    parts.push(texts.shellActions.metadataSignature);
  }
  if (notices.includes("image_reencoded")) {
    parts.push(texts.shellActions.metadataReencoded);
  }
  return { ok: true, outputPath: output, copied: false, notice: parts.join(" ") };
}

/** `name` next to `inputPath`, with " (2)", " (3)"… added when that file already exists. */
async function freePath(deps: ShellActionDeps, inputPath: string, name: string): Promise<string> {
  const directory = directoryOf(inputPath);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate = joinPath(directory, attempt === 1 ? name : `${stem} (${attempt})${extension}`);
    if (!(await deps.exists(candidate))) {
      return candidate;
    }
  }
  throw new Error("Nie udało się znaleźć wolnej nazwy pliku.");
}

export function filenameOf(path: string): string {
  return path.split(/[\\/]/).pop() || "dokument";
}

export function directoryOf(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index >= 0 ? path.slice(0, index) : ".";
}

function joinPath(directory: string, filename: string): string {
  if (directory.endsWith("/") || directory.endsWith("\\")) {
    return `${directory}${filename}`;
  }
  return `${directory}${directory.includes("\\") ? "\\" : "/"}${filename}`;
}

function baseName(name: string): string {
  return name.replace(/\.[^./\\]+$/, "") || "dokument";
}

function extensionOf(name: string): string {
  return name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";
}
