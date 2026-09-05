import { afterEach, describe, expect, it, vi } from "vitest";

const open = vi.fn();
const save = vi.fn();
const confirmDialog = vi.fn();
const readDir = vi.fn();
const readFile = vi.fn();
const readTextFile = vi.fn();
const writeFile = vi.fn();
const writeTextFile = vi.fn();
const onDragDropEvent = vi.fn();
const getCurrentWebview = vi.fn(() => ({ onDragDropEvent }));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => open(...args),
  save: (...args: unknown[]) => save(...args),
  confirm: (...args: unknown[]) => confirmDialog(...args),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: (...args: unknown[]) => readDir(...args),
  readFile: (...args: unknown[]) => readFile(...args),
  readTextFile: (...args: unknown[]) => readTextFile(...args),
  writeFile: (...args: unknown[]) => writeFile(...args),
  writeTextFile: (...args: unknown[]) => writeTextFile(...args),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: (...args: unknown[]) => getCurrentWebview(...args),
}));

import {
  confirmSensitiveAction,
  exportBatchResultsToDirectory,
  fileFromPath,
  isSupportedDocumentName,
  listenToDroppedFiles,
  mimeForFilename,
  pickDocumentFile,
  pickDocumentFiles,
  pickDocumentFolderFiles,
  pickOutputDirectory,
  pickReplacementMapFile,
  saveBinaryFile,
  saveJsonFile,
} from "./files";

afterEach(() => {
  vi.clearAllMocks();
});

describe("pickDocumentFile", () => {
  it("returns a File built from the selected path", async () => {
    open.mockResolvedValue("C:\\Users\\michal\\Pulpit\\pismo.txt");
    readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const file = await pickDocumentFile();

    expect(file?.name).toBe("pismo.txt");
    expect(file?.type).toBe("text/plain");
  });

  it("returns null when the user cancels the dialog", async () => {
    open.mockResolvedValue(null);

    await expect(pickDocumentFile()).resolves.toBeNull();
  });

  it("returns null if the dialog unexpectedly yields an array", async () => {
    open.mockResolvedValue(["a.txt", "b.txt"]);

    await expect(pickDocumentFile()).resolves.toBeNull();
  });
});

describe("pickDocumentFiles", () => {
  it("returns an empty list when the user cancels", async () => {
    open.mockResolvedValue(null);

    await expect(pickDocumentFiles()).resolves.toEqual([]);
  });

  it("wraps a single selected path into a one-item list", async () => {
    open.mockResolvedValue("a.pdf");
    readFile.mockResolvedValue(new Uint8Array());

    const files = await pickDocumentFiles();

    expect(files.map((file) => file.name)).toEqual(["a.pdf"]);
  });

  it("reads every path when multiple files are selected", async () => {
    open.mockResolvedValue(["a.pdf", "b.docx"]);
    readFile.mockResolvedValue(new Uint8Array());

    const files = await pickDocumentFiles();

    expect(files.map((file) => file.name)).toEqual(["a.pdf", "b.docx"]);
  });
});

describe("pickDocumentFolderFiles", () => {
  it("returns [] when the user cancels", async () => {
    open.mockResolvedValue(null);

    await expect(pickDocumentFolderFiles()).resolves.toEqual([]);
  });

  it("recursively collects supported files, skips unsupported ones, sorted by name", async () => {
    open.mockResolvedValue("C:\\dokumenty");
    readDir.mockImplementation(async (directory: string) => {
      if (directory === "C:\\dokumenty") {
        return [
          { name: "zebra.txt", isDirectory: false, isFile: true },
          { name: "podfolder", isDirectory: true, isFile: false },
          { name: "obraz.json", isDirectory: false, isFile: true },
        ];
      }
      return [{ name: "alfa.pdf", isDirectory: false, isFile: true }];
    });
    readFile.mockResolvedValue(new Uint8Array());

    const files = await pickDocumentFolderFiles();

    expect(files.map((file) => file.name)).toEqual(["alfa.pdf", "zebra.txt"]);
  });
});

describe("pickReplacementMapFile", () => {
  it("returns the file contents as text", async () => {
    open.mockResolvedValue("mapa.json");
    readTextFile.mockResolvedValue('{"entries":[]}');

    await expect(pickReplacementMapFile()).resolves.toBe('{"entries":[]}');
  });

  it("returns null when cancelled", async () => {
    open.mockResolvedValue(null);

    await expect(pickReplacementMapFile()).resolves.toBeNull();
  });
});

describe("pickOutputDirectory", () => {
  it("returns the chosen directory path", async () => {
    open.mockResolvedValue("C:\\eksport");

    await expect(pickOutputDirectory()).resolves.toBe("C:\\eksport");
  });

  it("returns null when cancelled or an array is returned", async () => {
    open.mockResolvedValue(null);
    await expect(pickOutputDirectory()).resolves.toBeNull();

    open.mockResolvedValue(["a", "b"]);
    await expect(pickOutputDirectory()).resolves.toBeNull();
  });
});

describe("saveJsonFile", () => {
  it("writes the contents when a path is chosen", async () => {
    save.mockResolvedValue("mapa.json");

    await saveJsonFile("mapa.json", '{"a":1}');

    expect(writeTextFile).toHaveBeenCalledWith("mapa.json", '{"a":1}');
  });

  it("does nothing when the user cancels the save dialog", async () => {
    save.mockResolvedValue(null);

    await saveJsonFile("mapa.json", '{"a":1}');

    expect(writeTextFile).not.toHaveBeenCalled();
  });
});

describe("saveBinaryFile", () => {
  it("writes the blob bytes when a path is chosen", async () => {
    save.mockResolvedValue("dokument.docx");
    const blob = new Blob(["tresc"], { type: "text/plain" });

    await saveBinaryFile("dokument.docx", blob, "docx");

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, bytes] = writeFile.mock.calls[0];
    expect(path).toBe("dokument.docx");
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it("does nothing when the user cancels the save dialog", async () => {
    save.mockResolvedValue(null);

    await saveBinaryFile("dokument.pdf", new Blob(["x"]), "pdf");

    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("exportBatchResultsToDirectory", () => {
  it("writes an .anon.txt and .map.json pair per item and returns the file count", async () => {
    const count = await exportBatchResultsToDirectory("C:\\eksport", [
      {
        filename: "pismo.txt",
        anonymizedText: "[OSOBA_1] zlozyl pozew.",
        replacementMap: { entries: [], document_fingerprint: "f1" } as never,
      },
    ]);

    expect(count).toBe(2);
    expect(writeTextFile).toHaveBeenCalledWith(
      "C:\\eksport\\pismo.anon.txt",
      "[OSOBA_1] zlozyl pozew.",
    );
    expect(writeTextFile).toHaveBeenCalledWith(
      "C:\\eksport\\pismo.map.json",
      expect.stringContaining("document_fingerprint"),
    );
  });
});

describe("confirmSensitiveAction", () => {
  it("returns the native Tauri confirm result", async () => {
    confirmDialog.mockResolvedValue(true);

    await expect(confirmSensitiveAction("Na pewno?", "Uwaga")).resolves.toBe(true);
    expect(confirmDialog).toHaveBeenCalledWith("Na pewno?", { title: "Uwaga", kind: "warning" });
  });

  it("falls back to window.confirm when the Tauri dialog throws", async () => {
    confirmDialog.mockRejectedValue(new Error("dialog unavailable"));
    const windowConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await expect(confirmSensitiveAction("Na pewno?", "Uwaga")).resolves.toBe(false);
    expect(windowConfirm).toHaveBeenCalledWith("Na pewno?");
  });
});

describe("fileFromPath", () => {
  it("builds a File with the basename and inferred MIME type from a Windows path", async () => {
    readFile.mockResolvedValue(new Uint8Array([1, 2]));

    const file = await fileFromPath("C:\\Users\\michal\\Pulpit\\skan.png");

    expect(file.name).toBe("skan.png");
    expect(file.type).toBe("image/png");
  });
});

describe("isSupportedDocumentName", () => {
  it.each([
    ["pismo.pdf", true],
    ["pismo.PDF", true],
    ["pismo.docx", true],
    ["skan.jpeg", true],
    ["dane.json", false],
    ["bez_rozszerzenia", false],
  ])("%s -> %s", (name, expected) => {
    expect(isSupportedDocumentName(name)).toBe(expected);
  });
});

describe("mimeForFilename", () => {
  it("maps known extensions to their MIME type", () => {
    expect(mimeForFilename("a.pdf")).toBe("application/pdf");
    expect(mimeForFilename("a.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("falls back to octet-stream for unknown extensions", () => {
    expect(mimeForFilename("a.xyz")).toBe("application/octet-stream");
  });
});

describe("listenToDroppedFiles", () => {
  it("invokes the handler only for drop events carrying paths", async () => {
    let capturedCallback: ((event: unknown) => void) | undefined;
    onDragDropEvent.mockImplementation((callback: (event: unknown) => void) => {
      capturedCallback = callback;
      return Promise.resolve(vi.fn());
    });
    const handler = vi.fn();

    await listenToDroppedFiles(handler);
    capturedCallback?.({ payload: { type: "over" } });
    capturedCallback?.({ payload: { type: "drop", paths: ["a.txt", "b.txt"] } });
    capturedCallback?.({ payload: { type: "drop", paths: [] } });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(["a.txt", "b.txt"]);
  });
});
