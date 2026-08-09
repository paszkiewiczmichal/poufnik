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
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
