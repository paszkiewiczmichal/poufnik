import { describe, expect, it, vi } from "vitest";

import { createAnonymizerApiClient } from "./client";
import type { DocumentProcessResponse, EngineEndpoint } from "../types";

const endpoint: EngineEndpoint = {
  baseUrl: "http://127.0.0.1:8710",
  port: 8710,
  token: "test-token",
};

describe("createAnonymizerApiClient", () => {
  it("posts document multipart data with API token", async () => {
    const responsePayload: DocumentProcessResponse = {
      document: {
        filename: "umowa.docx",
        format: "docx",
        source: "parsed",
        page_count: 1,
        text: "Jan Kowalski",
      },
      entities: [],
      anonymized_text: "Jan Kowalski",
      replacement_map: {
        entries: [],
        document_fingerprint: "abc",
      },
    };
    const fetcher = vi.fn(async () => jsonResponse(responsePayload));
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);
    const file = new File(["content"], "umowa.docx");

    await expect(client.processDocument(file, { forceOcr: true })).resolves.toEqual(
      responsePayload,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8710/v1/documents/process",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Api-Key": "test-token" }),
        body: expect.any(FormData),
      }),
    );
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    const body = calls[0][1].body as FormData;
    expect(body.get("force_ocr")).toBe("true");
    expect(body.get("language")).toBe("pl");
    expect(body.get("file")).toBeInstanceOf(File);
  });

  it("throws ApiError for problem responses", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          title: "Payload Too Large",
          status: 413,
          detail: "Request payload exceeds the 100 MB limit.",
        },
        413,
      ),
    );
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    await expect(client.health()).rejects.toMatchObject({
      status: 413,
      title: "Payload Too Large",
      detail: "Request payload exceeds the 100 MB limit.",
    });
  });

  it("posts anonymize request with local entity ids stripped and statuses preserved", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        anonymized_text: "Jan [DANE_1]",
        replacement_map: { entries: [], document_fingerprint: "abc" },
      }),
    );
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    await client.anonymize("Jan ABC", [
      {
        id: "local-1",
        category: "CUSTOM",
        start: 4,
        end: 7,
        text: "ABC",
        confidence: 1,
        source: "manual",
        validation: "not_applicable",
        status: "rejected",
        entity_group_id: "group-1",
        canonical_text: "ABC",
      },
    ]);

    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    const body = JSON.parse(calls[0][1].body as string) as {
      entities: Array<Record<string, unknown>>;
    };
    expect(body.entities[0].id).toBeUndefined();
    expect(body.entities[0].status).toBe("rejected");
    expect(body.entities[0].source).toBe("manual");
  });

  it("posts analyze request with custom regex rules", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ entities: [] }));
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    await client.analyze("Sygnatura ABC-XYZ-77", [
      { name: "Sygnatura", label: "Sygnatura", pattern: "ABC-[A-Z]{3}-\\d{2}" },
    ]);

    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("http://127.0.0.1:8710/v1/analyze");
    expect(JSON.parse(calls[0][1].body as string)).toEqual({
      text: "Sygnatura ABC-XYZ-77",
      language: "pl",
      custom_rules: [
        { name: "Sygnatura", label: "Sygnatura", pattern: "ABC-[A-Z]{3}-\\d{2}" },
      ],
    });
  });

  it("posts export request and returns a blob", async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(["docx"])));
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    await expect(
      client.exportDocument({
        anonymizedText: "Treść [OSOBA_1]",
        format: "docx",
        blocks: [{ start: 0, end: 15, kind: "paragraph", page: 1 }],
      }),
    ).resolves.toBeInstanceOf(Blob);

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8710/v1/export",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Api-Key": "test-token",
        }),
      }),
    );
  });
  it("posts anonymizeApiEntities with raw API entities untouched", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        anonymized_text: "[OSOBA_1]",
        replacement_map: { entries: [], document_fingerprint: "abc" },
      }),
    );
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    await client.anonymizeApiEntities("Jan Kowalski", [
      { start: 0, end: 12, text: "Jan Kowalski", category: "PERSON", confidence: 0.9, validation: "not_applicable" },
    ]);

    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(calls[0][1].body as string)).toEqual({
      text: "Jan Kowalski",
      language: "pl",
      entities: [
        { start: 0, end: 12, text: "Jan Kowalski", category: "PERSON", confidence: 0.9, validation: "not_applicable" },
      ],
    });
  });

  it("posts deanonymize with the replacement map", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ restored_text: "Jan Kowalski", warnings: [] }));
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);
    const replacementMap = { entries: [], document_fingerprint: "abc" };

    await client.deanonymize("[OSOBA_1]", replacementMap);

    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("http://127.0.0.1:8710/v1/deanonymize");
    expect(JSON.parse(calls[0][1].body as string)).toEqual({
      text: "[OSOBA_1]",
      replacement_map: replacementMap,
    });
  });

  it("lists prompts via a plain GET", async () => {
    const fetcher = vi.fn(async () => jsonResponse([{ id: "p1" }]));
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    await expect(client.listPrompts()).resolves.toEqual([{ id: "p1" }]);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8710/v1/prompts",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Api-Key": "test-token" }) }),
    );
  });

  it("throws ApiError for a failed export request", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 500, statusText: "Server Error" }));
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    await expect(
      client.exportDocument({ anonymizedText: "text", format: "pdf" }),
    ).rejects.toMatchObject({ status: 500, title: "Server Error" });
  });

  it("falls back to a null problem when the error response is not JSON", async () => {
    const fetcher = vi.fn(
      async () => new Response("plain text error", { status: 502, statusText: "Bad Gateway" }),
    );
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    await expect(client.health()).rejects.toMatchObject({
      status: 502,
      title: "Bad Gateway",
      detail: "Request failed.",
    });
  });

  it("falls back to a null problem when the JSON error body cannot be parsed", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("not actually json", {
          status: 500,
          statusText: "Server Error",
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    await expect(client.health()).rejects.toMatchObject({
      status: 500,
      title: "Server Error",
      detail: "Request failed.",
    });
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
