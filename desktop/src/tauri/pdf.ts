import { invoke } from "@tauri-apps/api/core";

/** Office program that turns a DOCX into a faithful PDF on this computer, if any. */
export type PdfRenderer = "word" | "libreoffice";

export async function getPdfRenderer(): Promise<PdfRenderer | null> {
  try {
    return await invoke<PdfRenderer | null>("pdf_renderer");
  } catch {
    // Outside the desktop shell (browser preview) there is no renderer.
    return null;
  }
}

/**
 * Turns an old Word (.doc) or RTF file into DOCX with the installed Word (or LibreOffice),
 * so it takes the DOCX path: layout kept, anonymized in place. Rejects with "no_renderer"
 * when neither program is installed.
 */
export async function convertToDocx(file: File, extension: string): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const docx = await invoke<ArrayBuffer>("convert_to_docx", bytes, {
    headers: { "x-poufnik-extension": extension },
  });
  const name = file.name.replace(/\.[^.]+$/, "") + ".docx";
  return new File([docx], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

/** Renders an anonymized DOCX to PDF with Word (or LibreOffice); bytes travel as raw IPC. */
export async function renderDocxToPdf(docx: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await docx.arrayBuffer());
  const pdf = await invoke<ArrayBuffer>("render_docx_to_pdf", bytes);
  return new Blob([pdf], { type: "application/pdf" });
}

/** Neither Microsoft Office nor LibreOffice is available to draw the file. */
export class NoPreviewConverterError extends Error {
  constructor() {
    super("no_renderer");
  }
}

/**
 * Turns a spreadsheet, presentation or OpenDocument file into a PDF with the installed Office
 * (or LibreOffice), so the window can draw it page by page. Rejects with
 * NoPreviewConverterError when no program can do it, also outside the desktop shell.
 */
export async function convertToPdf(file: Blob, extension: string): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const pdf = await invoke<ArrayBuffer>("convert_to_pdf", bytes, {
      headers: { "x-poufnik-extension": extension },
    });
    return new Blob([pdf], { type: "application/pdf" });
  } catch (error) {
    // The desktop command rejects with a string; anything else means no shell (browser).
    if (typeof error !== "string" || error === "no_renderer") {
      throw new NoPreviewConverterError();
    }
    throw new Error(error);
  }
}
