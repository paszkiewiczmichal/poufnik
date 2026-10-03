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

/** Renders an anonymized DOCX to PDF with Word (or LibreOffice); bytes travel as raw IPC. */
export async function renderDocxToPdf(docx: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await docx.arrayBuffer());
  const pdf = await invoke<ArrayBuffer>("render_docx_to_pdf", bytes);
  return new Blob([pdf], { type: "application/pdf" });
}
