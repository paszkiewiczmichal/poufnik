import { describe, expect, it, vi } from "vitest";

import { createAnonymizerApiClient } from "./client";
import type { DocumentProcessResponse, EngineEndpoint, ReplacementMap } from "../types";

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
    expect(body.get("language")).toBe("auto");
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
      language: "auto",
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
  it("sends the original DOCX, offsets and text as file parts for in-place export", async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(["docx"])));
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);
    const file = new File(["PK"], "umowa.docx");
    const offsetMap = [
      {
        original_start: 0,
        original_end: 12,
        anonymized_start: 0,
        anonymized_end: 9,
        token: "[OSOBA_1]",
        category: "PERSON",
      },
    ];

    await expect(
      client.exportDocxInPlace({ file, offsetMap, anonymizedText: "[OSOBA_1] zażółć" }),
    ).resolves.toBeInstanceOf(Blob);

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8710/v1/export/docx");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect((form.get("file") as File).name).toBe("umowa.docx");
    expect(JSON.parse(await (form.get("offset_map") as Blob).text())).toEqual(offsetMap);
    expect(await (form.get("anonymized_text") as Blob).text()).toBe("[OSOBA_1] zażółć");
  });

  it("sends the file and the replacement map to restore a DOCX in place", async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(["docx"])));
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);
    const replacementMap = {
      entries: [{ token: "[OSOBA_1]", category: "PERSON", canonical_text: "Jan Łęcki" }],
      created_at: "2026-11-13T10:00:00Z",
      document_fingerprint: "abc",
    } as ReplacementMap;

    await client.restoreDocxInPlace({
      file: new File(["docx"], "pismo_poufnik.docx"),
      replacementMap,
    });

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8710/v1/restore/docx");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect((form.get("file") as File).name).toBe("pismo_poufnik.docx");
    expect(JSON.parse(await (form.get("replacement_map") as Blob).text())).toEqual(replacementMap);
  });

  it("hands over the restore warnings from the X-Poufnik-Warnings header", async () => {
    const warnings = ["Unknown anonymization token [OŚWIATA_7] at offset 5."];
    const fetcher = vi.fn(
      async () =>
        new Response("docx", {
          headers: { "X-Poufnik-Warnings": encodeURIComponent(JSON.stringify(warnings)) },
        }),
    );
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    const blob = await client.restoreDocxInPlace({
      file: new File(["docx"], "pismo.docx"),
      replacementMap: { entries: [] } as unknown as ReplacementMap,
    });

    expect(blob.warnings).toEqual(warnings);
  });

  it("tolerates a missing or garbled warnings header", async () => {
    for (const header of [null, "%E0%A4%A", encodeURIComponent('{"a":1}'), "nie-json"]) {
      const fetcher = vi.fn(
        async () =>
          new Response("docx", { headers: header === null ? {} : { "X-Poufnik-Warnings": header } }),
      );
      const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

      const blob = await client.restoreDocxInPlace({
        file: new File(["docx"], "pismo.docx"),
        replacementMap: { entries: [] } as unknown as ReplacementMap,
      });

      expect(blob.warnings ?? []).toEqual([]);
    }
  });

  it("asks for fictional data when it is chosen in Settings, and only then", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ anonymized_text: "" })));
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    await client.anonymize("tekst", []);
    window.localStorage.setItem("anonymizer.replacementMode.v1", "pseudonyms");
    try {
      await client.anonymize("tekst", []);
      await client.processDocument(new File(["x"], "a.txt"), { forceOcr: false }).catch(() => null);
    } finally {
      window.localStorage.removeItem("anonymizer.replacementMode.v1");
    }

    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(calls[0][1].body as string).mode).toBeUndefined();
    expect(JSON.parse(calls[1][1].body as string).mode).toBe("pseudonyms");
    expect((calls[2][1].body as FormData).get("mode")).toBe("pseudonyms");
  });

  it("hands over what an in-place export did to pictures", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("docx", { headers: { "X-Poufnik-Notices": "pictures_redacted" } }),
    );
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    const blob = await client.exportDocxInPlace({
      file: new File(["docx"], "umowa.docx"),
      offsetMap: [],
      anonymizedText: "",
    });

    expect(blob.notices).toEqual(["pictures_redacted"]);
  });

  it("sends the face setting with every in-place export: on by default, off when chosen", async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(["x"])));
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);
    const send = async () => {
      const common = { file: new File(["x"], "a.bin"), offsetMap: [], anonymizedText: "" };
      await client.exportDocxInPlace(common);
      await client.exportInPlace({ ...common, kind: "image" });
      await client.exportPdfInPlace({ ...common, ocr: true });
    };

    await send();
    window.localStorage.setItem("anonymizer.maskFaces.v1", "false");
    try {
      await send();
    } finally {
      window.localStorage.removeItem("anonymizer.maskFaces.v1");
    }

    const forms = (fetcher.mock.calls as unknown as [string, RequestInit][]).map(
      ([, init]) => (init.body as FormData).get("mask_faces"),
    );
    expect(forms).toEqual(["true", "true", "true", "false", "false", "false"]);
  });

  it("returns the cleaned file with the codes of removed metadata", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("clean", {
          headers: { "X-Poufnik-Removed": "exif,gps", "X-Poufnik-Notices": "" },
        }),
    );
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    const result = await client.cleanMetadata(new File(["jpg"], "dowod.jpg"));

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8710/v1/metadata/clean");
    expect(((init.body as FormData).get("file") as File).name).toBe("dowod.jpg");
    expect(result.removed).toEqual(["exif", "gps"]);
    expect(result.notices).toEqual([]);
    expect(await result.blob.text()).toBe("clean");
  });

  it("sends the OCR flag with an in-place PDF export", async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(["%PDF"])));
    const client = createAnonymizerApiClient(endpoint, fetcher as unknown as typeof fetch);

    await client.exportPdfInPlace({
      file: new File(["%PDF"], "skan.pdf"),
      offsetMap: [],
      anonymizedText: "tekst",
      ocr: true,
    });

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8710/v1/export/pdf");
    const form = init.body as FormData;
    expect(form.get("ocr")).toBe("true");
    expect((form.get("file") as File).name).toBe("skan.pdf");
    expect(await (form.get("anonymized_text") as Blob).text()).toBe("tekst");
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
      language: "auto",
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
