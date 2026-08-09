import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { readDir, readFile, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { batchExportFiles, type BatchExportInput } from "../domain/batchExport";

const ACCEPTED_EXTENSIONS = ["pdf", "docx", "txt", "png", "jpg", "jpeg", "heic", "heif"] as const;
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  heif: "image/heif",
};

export async function pickDocumentFile(): Promise<File | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Wybierz dokument",
    filters: [{ name: "Dokumenty", extensions: [...ACCEPTED_EXTENSIONS] }],
  });

  if (!selected || Array.isArray(selected)) {
    return null;
  }

  return fileFromPath(selected);
}

export async function pickDocumentFiles(): Promise<File[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    title: "Wybierz dokumenty",
    filters: [{ name: "Dokumenty", extensions: [...ACCEPTED_EXTENSIONS] }],
  });

  if (!selected) {
    return [];
  }

  const paths = Array.isArray(selected) ? selected : [selected];
  return Promise.all(paths.map(fileFromPath));
}

export async function pickDocumentFolderFiles(): Promise<File[]> {
  const selected = await open({
    multiple: false,
    directory: true,
    title: "Wybierz folder z dokumentami",
  });

  if (!selected || Array.isArray(selected)) {
    return [];
  }

  return filesFromDirectory(selected);
}

export async function pickReplacementMapFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Wczytaj mapę zastąpień",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (!selected || Array.isArray(selected)) {
    return null;
  }

  return readTextFile(selected);
}

export async function pickOutputDirectory(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: true,
    title: "Wybierz folder eksportu",
  });

  if (!selected || Array.isArray(selected)) {
    return null;
  }

  return selected;
}

export async function saveJsonFile(defaultPath: string, contents: string): Promise<void> {
  const path = await save({
    title: "Zapisz plik JSON",
    defaultPath,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (path) {
    await writeTextFile(path, contents);
  }
}

export async function saveBinaryFile(
  defaultPath: string,
  blob: Blob,
  extension: "docx" | "pdf",
): Promise<void> {
  const path = await save({
    title: "Zapisz dokument",
    defaultPath,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
  if (path) {
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  }
}

export async function exportBatchResultsToDirectory(
  directory: string,
  items: BatchExportInput[],
): Promise<number> {
  const files = batchExportFiles(items);
  await Promise.all(
    files.map((file) => writeTextFile(joinPath(directory, file.filename), file.contents)),
  );
  return files.length;
}

export async function confirmSensitiveAction(message: string, title: string): Promise<boolean> {
  try {
    return await confirm(message, { title, kind: "warning" });
  } catch {
    return window.confirm(message);
  }
}

export function pickBrowserDocumentFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(",");
    input.onchange = () => resolve(input.files?.item(0) ?? null);
    input.click();
  });
}

export function pickBrowserDocumentFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(",");
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export async function fileFromPath(path: string): Promise<File> {
  const bytes = await readFile(path);
  const name = filenameFromPath(path);
  return new File([bytes], name, { type: mimeForFilename(name) });
}

async function filesFromDirectory(rootPath: string): Promise<File[]> {
  const files: File[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readDir(directory);
    await Promise.all(
      entries.map(async (entry) => {
        const childPath = joinPath(directory, entry.name);
        if (entry.isDirectory) {
          await visit(childPath);
        } else if (entry.isFile && isSupportedDocumentName(entry.name)) {
          files.push(await fileFromPath(childPath));
        }
      }),
    );
  }

  await visit(rootPath);
  return files.sort((left, right) => left.name.localeCompare(right.name, "pl"));
}

export async function listenToDroppedFiles(
  handler: (paths: string[]) => void,
): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload as { type: string; paths?: string[] };
    if (payload.type === "drop" && payload.paths?.length) {
      handler(payload.paths);
    }
  });
}

export function isSupportedDocumentName(name: string): boolean {
  return ACCEPTED_EXTENSIONS.includes(extensionOf(name) as (typeof ACCEPTED_EXTENSIONS)[number]);
}

export function mimeForFilename(name: string): string {
  return MIME_BY_EXTENSION[extensionOf(name)] ?? "application/octet-stream";
}

function filenameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || "document";
}

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function joinPath(directory: string, filename: string): string {
  if (directory.endsWith("/") || directory.endsWith("\\")) {
    return `${directory}${filename}`;
  }
  return `${directory}${directory.includes("\\") ? "\\" : "/"}${filename}`;
}
