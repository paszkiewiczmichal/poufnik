/** How a document can be shown 1:1 in the window (pages as they print). */
export type PreviewKind = "pdf" | "docx" | "image" | "office";

/**
 * The 1:1 preview of a file in this format, or null when the window can only show its text
 * (TXT). "office" files (spreadsheets, presentations, OpenDocument) have no page renderer in
 * the window: Excel, PowerPoint, Word or LibreOffice turns them into a PDF first.
 */
export function previewKind(format: string | null | undefined): PreviewKind | null {
  switch (format) {
    case "pdf":
      return "pdf";
    case "docx":
      return "docx";
    case "png":
    case "jpg":
    case "jpeg":
    case "heic":
      return "image";
    case "xlsx":
    case "ods":
    case "pptx":
    case "odp":
    case "odt":
      return "office";
    default:
      return null;
  }
}

/** The original file can be shown as is, except HEIC photos the webview cannot decode. */
export function originalPreviewKind(file: File | null, format: string | null | undefined) {
  if (!file) {
    return null;
  }
  return format === "heic" ? null : previewKind(format);
}
