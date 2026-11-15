import { texts } from "../i18n";

/** Formats Poufnik opens by converting them to DOCX first (Word or LibreOffice). */
export const LEGACY_WORD_EXTENSIONS = ["doc", "rtf"] as const;
export const CONVERTED_NOTICE = "converted_to_docx";

export function legacyExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return (LEGACY_WORD_EXTENSIONS as readonly string[]).includes(extension) ? extension : null;
}

/**
 * The file to anonymize: a DOC or RTF converted to DOCX, any other file as it is. The
 * second value says whether a conversion happened (the result is then saved as DOCX).
 */
export async function prepareDocument(
  file: File,
  convert: (file: File, extension: string) => Promise<File>,
): Promise<{ file: File; converted: boolean }> {
  const extension = legacyExtension(file.name);
  if (!extension) {
    return { file, converted: false };
  }
  try {
    return { file: await convert(file, extension), converted: true };
  } catch (error) {
    const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
    throw new Error(
      message === "no_renderer"
        ? texts.errors.legacyNeedsOffice(extension.toUpperCase())
        : texts.errors.legacyConversionFailed(extension.toUpperCase(), message),
    );
  }
}
