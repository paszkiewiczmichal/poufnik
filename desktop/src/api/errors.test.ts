import { describe, expect, it } from "vitest";

import { ApiError } from "./client";
import { toUserMessage } from "./errors";
import { texts } from "../i18n";

function apiError(options: {
  status?: number;
  title?: string;
  detail?: string | null;
}): ApiError {
  const response = new Response(null, {
    status: options.status ?? 500,
    statusText: options.title ?? "Error",
  });
  const problem =
    options.detail === undefined && options.title === undefined
      ? null
      : { title: options.title ?? "Error", detail: options.detail ?? undefined, status: options.status };
  return new ApiError(response, problem as never);
}

describe("toUserMessage", () => {
  it("maps a 413 ApiError to the payload-too-large message", () => {
    expect(toUserMessage(apiError({ status: 413 }))).toBe(texts.errors.payloadTooLarge);
  });

  it("maps a 'Payload Too Large' title to the payload-too-large message regardless of status", () => {
    expect(toUserMessage(apiError({ status: 400, title: "Payload Too Large" }))).toBe(
      texts.errors.payloadTooLarge,
    );
  });

  it("maps an ApiError detail mentioning Tesseract to the tesseract-not-found message", () => {
    expect(
      toUserMessage(
        apiError({ detail: "Tesseract executable was not found in PATH." }),
      ),
    ).toBe(texts.errors.tesseractNotFound);
  });

  it("returns the ApiError detail verbatim for an ordinary failure", () => {
    expect(toUserMessage(apiError({ detail: "Nieprawidłowy format pliku." }))).toBe(
      "Nieprawidłowy format pliku.",
    );
  });

  it("maps a plain Error mentioning Tesseract to the tesseract-not-found message", () => {
    expect(toUserMessage(new Error("Tesseract executable was not found"))).toBe(
      texts.errors.tesseractNotFound,
    );
  });

  it("returns a plain Error's own message", () => {
    expect(toUserMessage(new Error("network down"))).toBe("network down");
  });

  it("falls back to the generic message for a non-Error value", () => {
    expect(toUserMessage("some string")).toBe(texts.errors.generic);
    expect(toUserMessage(null)).toBe(texts.errors.generic);
    expect(toUserMessage(undefined)).toBe(texts.errors.generic);
  });
});
