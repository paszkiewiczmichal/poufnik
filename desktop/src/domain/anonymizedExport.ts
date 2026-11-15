import type { AnonymizerApiClient, ExportedBlob, InPlaceKind } from "../api/client";
import { fallbackOnEngineRefusal } from "../api/errors";
import { texts } from "../i18n";
import type { PdfRenderer } from "../tauri/pdf";
import type { ExportFormat, OffsetMapEntry, ProcessedDocument } from "../types";
import { blocksForExport } from "./documentSegments";

// Silnik zgłasza, że PDF udało się wczytać, ale nie da się go wyeksportować w miejscu.
export const PDF_LAYOUT_UNAVAILABLE = "pdf_layout_export_unavailable";

export interface AnonymizedExportSource {
  document: ProcessedDocument | null;
  sourceFile: File | null;
  anonymizedText: string;
  offsetMap: OffsetMapEntry[];
}

export interface AnonymizedExportPlatform {
  getPdfRenderer: () => Promise<PdfRenderer | null>;
  renderDocxToPdf: (docx: Blob) => Promise<Blob>;
  isMacAppStore: boolean;
}

export interface AnonymizedExport {
  blob: Blob;
  /** Shown to the user when the file differs from the original layout. */
  notice: string | null;
}

/** Builds the anonymized file in the original layout when possible, simplified otherwise. */
export async function buildAnonymizedExport(
  client: AnonymizerApiClient,
  source: AnonymizedExportSource,
  format: ExportFormat,
  platform: AnonymizedExportPlatform,
): Promise<AnonymizedExport> {
  const { document, sourceFile, anonymizedText, offsetMap } = source;
  // Built only from the anonymized text, so it cannot contain an original value.
  const exportSimplified = async (target: ExportFormat, notice: string | null) => ({
    blob: await client.exportDocument({
      anonymizedText,
      format: target,
      blocks: blocksForExport(anonymizedText),
    }),
    notice,
  });
  const sourceIsDocx = document?.format === "docx";
  const renderer =
    format === "pdf" && sourceIsDocx && sourceFile ? await platform.getPdfRenderer() : null;
  if (sourceIsDocx && sourceFile && (format === "docx" || renderer)) {
    // Same file, same offsets: the engine edits the original XML and keeps the layout.
    const docx = await client
      .exportDocxInPlace({ file: sourceFile, offsetMap, anonymizedText })
      .catch(fallbackOnEngineRefusal);
    if (!docx) {
      return exportSimplified(format, texts.generation.exportFaithfulFailed);
    }
    if (format === "docx") {
      return { blob: docx, notice: pictureNotice(docx) };
    }
    // The installed office suite lays out the anonymized DOCX exactly as it would the
    // original, so the PDF looks like the source document.
    const pdf = await platform.renderDocxToPdf(docx).catch((error: unknown) => {
      // The desktop command rejects with a Polish message naming the program.
      throw new Error(typeof error === "string" ? error : texts.errors.pdfRenderFailed);
    });
    return {
      blob: pdf,
      notice: renderer === "libreoffice" ? texts.generation.exportPdfLibreOffice : null,
    };
  }
  const sourceIsPdf = document?.format === "pdf";
  const pdfLayoutKnown = !document?.notices?.includes(PDF_LAYOUT_UNAVAILABLE);
  if (format === "pdf" && sourceIsPdf && sourceFile && pdfLayoutKnown) {
    // Glyphs of the values are removed from the original PDF (scans: painted over).
    const pdf = await client
      .exportPdfInPlace({
        file: sourceFile,
        offsetMap,
        anonymizedText,
        ocr: document?.source === "ocr",
      })
      .catch(fallbackOnEngineRefusal);
    return pdf
      ? { blob: pdf, notice: null }
      : exportSimplified(format, texts.generation.exportFaithfulFailed);
  }
  let notice: string | null = null;
  if (sourceIsDocx) {
    notice =
      format === "docx" || !sourceFile
        ? texts.generation.exportSimplifiedLayout
        : platform.isMacAppStore
          ? texts.generation.exportPdfSandboxed
          : texts.generation.exportPdfWithoutWord;
  } else if (sourceIsPdf) {
    notice =
      format === "docx"
        ? texts.generation.exportDocxFromPdf
        : texts.generation.exportSimplifiedLayout;
  }
  return exportSimplified(format, notice);
}

// Formats the engine anonymizes in place in their own format: engine endpoint per format.
const OWN_FORMAT_KIND: Record<string, InPlaceKind> = {
  xlsx: "xlsx",
  pptx: "pptx",
  odt: "odt",
  ods: "ods",
  odp: "odp",
  png: "image",
  jpg: "image",
  heic: "image",
};
const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/heic": "heic",
  "image/heif": "heic",
};

/** The document's own format when Poufnik can save it anonymized in that format. */
/** What the engine did to pictures inside an office file, if anything. */
export function pictureNotice(blob: ExportedBlob): string | null {
  const notices = (blob.notices ?? [])
    .map((code) => texts.generation.pictureNotices[code])
    .filter((notice): notice is string => Boolean(notice));
  return notices.length > 0 ? notices.join(" ") : null;
}

export function ownExportFormat(document: ProcessedDocument | null): string | null {
  return document && document.format in OWN_FORMAT_KIND ? document.format : null;
}

export interface OwnFormatExport extends AnonymizedExport {
  /** Extension of the saved file (a fallback may change the format). */
  extension: string;
}

/**
 * The anonymized file in the source's own format (spreadsheet, presentation, OpenDocument,
 * picture). When the engine cannot do it safely, a simplified file built from the
 * anonymized text only is returned instead: DOCX for office files, PDF for pictures.
 */
export async function buildOwnFormatExport(
  client: AnonymizerApiClient,
  source: AnonymizedExportSource,
): Promise<OwnFormatExport> {
  const { document, sourceFile, anonymizedText, offsetMap } = source;
  const format = ownExportFormat(document);
  const kind = format ? OWN_FORMAT_KIND[format] : null;
  const blob =
    kind && sourceFile
      ? await client
          .exportInPlace({ kind, file: sourceFile, offsetMap, anonymizedText })
          .catch(fallbackOnEngineRefusal)
      : null;
  if (blob && format) {
    const extension =
      kind === "image" ? (IMAGE_EXTENSION_BY_TYPE[blob.type] ?? format) : format;
    return { blob, notice: pictureNotice(blob), extension };
  }
  const target: ExportFormat = kind === "image" ? "pdf" : "docx";
  return {
    blob: await client.exportDocument({
      anonymizedText,
      format: target,
      blocks: blocksForExport(anonymizedText),
    }),
    notice: texts.generation.exportFaithfulFailed,
    extension: target,
  };
}
