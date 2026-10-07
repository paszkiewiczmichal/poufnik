import { ApiError } from "./client";
import { texts } from "../i18n";

export function toUserMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413 || error.title === "Payload Too Large") {
      return texts.errors.payloadTooLarge;
    }
    if (error.detail.includes("Tesseract executable was not found")) {
      return texts.errors.tesseractNotFound;
    }
    return error.detail || texts.errors.generic;
  }

  if (error instanceof Error) {
    if (error.message.includes("Tesseract executable was not found")) {
      return texts.errors.tesseractNotFound;
    }
    return error.message;
  }

  return texts.errors.generic;
}

// The engine refuses an in-place export it cannot do safely (400/422). The caller then
// falls back to a simplified file built from the anonymized text instead of failing.
export function fallbackOnEngineRefusal(error: unknown): null {
  if (error instanceof ApiError && (error.status === 400 || error.status === 422)) {
    return null;
  }
  throw error;
}
