import type { ReportRequest } from "../domain/report";
import { loadMaskFaces, loadProfile, loadReplacementMode } from "../tauri/replacementMode";
import type {
  AnalyzeResponse,
  AnonymizeResponse,
  ApiDetectedEntity,
  CustomRegexRulePayload,
  DeanonymizeResponse,
  DetectedEntity,
  DocumentProcessResponse,
  EngineEndpoint,
  EngineHealthStatus,
  ExportBlock,
  ExportFormat,
  OffsetMapEntry,
  PromptTemplate,
  ReplacementMap,
} from "../types";

export interface ApiProblem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: unknown;
}

export type InPlaceKind = "xlsx" | "pptx" | "odt" | "ods" | "odp" | "image";

export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly problem: ApiProblem | null;

  constructor(response: Response, problem: ApiProblem | null) {
    const title = problem?.title ?? response.statusText;
    const detail = problem?.detail ?? "Request failed.";
    super(detail);
    this.name = "ApiError";
    this.status = problem?.status ?? response.status;
    this.title = title;
    this.detail = detail;
    this.problem = problem;
  }
}

export interface AnonymizerApiClient {
  health(): Promise<{
    status: EngineHealthStatus;
    version: string;
    models_loaded: boolean;
  }>;
  analyze(
    text: string,
    customRules?: CustomRegexRulePayload[],
    language?: string,
  ): Promise<AnalyzeResponse>;
  processDocument(
    file: File,
    options: { forceOcr: boolean; language?: string },
  ): Promise<DocumentProcessResponse>;
  /** ``caseMap``: map of the case's earlier documents; shared values keep their tokens. */
  anonymize(
    text: string,
    entities: DetectedEntity[],
    language?: string,
    caseMap?: ReplacementMap | null,
  ): Promise<AnonymizeResponse>;
  anonymizeApiEntities(
    text: string,
    entities: ApiDetectedEntity[],
    language?: string,
    caseMap?: ReplacementMap | null,
  ): Promise<AnonymizeResponse>;
  deanonymize(text: string, replacementMap: ReplacementMap): Promise<DeanonymizeResponse>;
  listPrompts(): Promise<PromptTemplate[]>;
  exportDocument(options: {
    anonymizedText: string;
    format: ExportFormat;
    blocks?: ExportBlock[];
  }): Promise<Blob>;
  /** Anonymizes the original DOCX in place, so the result keeps its full layout. */
  exportDocxInPlace(options: {
    file: File;
    offsetMap: OffsetMapEntry[];
    anonymizedText: string;
  }): Promise<Blob>;
  /** The same file without metadata; content untouched. Codes say what was removed. */
  cleanMetadata(file: File): Promise<{ blob: Blob; removed: string[]; notices: string[] }>;
  /** Puts the original values back into an anonymized DOCX, keeping its layout. */
  restoreDocxInPlace(options: { file: File; replacementMap: ReplacementMap }): Promise<ExportedBlob>;
  /**
   * Anonymizes a spreadsheet, presentation, OpenDocument file or picture in place and returns
   * it in its own format (``kind`` = engine endpoint: xlsx, pptx, odt, ods, odp or image).
   */
  exportInPlace(options: {
    kind: InPlaceKind;
    file: File;
    offsetMap: OffsetMapEntry[];
    anonymizedText: string;
  }): Promise<Blob>;
  /** Report for the case file (PDF): tokens, categories and decisions, no document value. */
  buildReport(request: ReportRequest): Promise<Blob>;
  /** Anonymizes the original PDF in place; ``ocr`` = the text was recognized by OCR. */
  exportPdfInPlace(options: {
    file: File;
    offsetMap: OffsetMapEntry[];
    anonymizedText: string;
    ocr: boolean;
  }): Promise<Blob>;
}

/** Fictional-data mode (Settings) travels with each request; tokens are the default. */
function modeField(): { mode?: "pseudonyms" } {
  return loadReplacementMode() === "pseudonyms" ? { mode: "pseudonyms" } : {};
}

/** A file from the engine; ``notices`` lists what an in-place export did besides the text. */
export type ExportedBlob = Blob & { notices?: string[]; warnings?: string[] };

/** X-Poufnik-Warnings: a percent-encoded JSON array of strings; absent or garbage = none. */
export function parseWarningsHeader(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function createAnonymizerApiClient(
  endpoint: EngineEndpoint,
  fetcher: typeof fetch = fetch,
): AnonymizerApiClient {
  const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetcher(`${endpoint.baseUrl}${path}`, {
      ...init,
      headers: {
        "X-Api-Key": endpoint.token,
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new ApiError(response, await readProblem(response));
    }

    return (await response.json()) as T;
  };

  const requestBlob = async (path: string, init: RequestInit = {}): Promise<Blob> => {
    const response = await fetcher(`${endpoint.baseUrl}${path}`, {
      ...init,
      headers: {
        "X-Api-Key": endpoint.token,
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new ApiError(response, await readProblem(response));
    }

    // Notices of an in-place export (e.g. pictures painted over) travel with the file.
    const blob: ExportedBlob = await response.blob();
    const notices = response.headers?.get?.("X-Poufnik-Notices");
    if (notices) {
      blob.notices = notices.split(",").filter((code) => code.length > 0);
    }
    const warnings = parseWarningsHeader(response.headers?.get?.("X-Poufnik-Warnings"));
    if (warnings.length > 0) {
      blob.warnings = warnings;
    }
    return blob;
  };

  return {
    health: () => requestJson("/v1/health"),
    analyze: (text, customRules = [], language = "pl") =>
      requestJson<AnalyzeResponse>("/v1/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          language,
          custom_rules: customRules,
          ...(loadProfile() === "judgment" ? { profile: "judgment" } : {}),
        }),
      }),
    processDocument: (file, options) => {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("force_ocr", String(options.forceOcr));
      form.append("language", options.language ?? "pl");
      if (loadReplacementMode() === "pseudonyms") {
        form.append("mode", "pseudonyms");
      }
      if (loadProfile() === "judgment") {
        form.append("profile", "judgment");
      }

      return requestJson<DocumentProcessResponse>("/v1/documents/process", {
        method: "POST",
        body: form,
      });
    },
    anonymize: (text, entities, language = "pl", caseMap = null) =>
      requestJson<AnonymizeResponse>("/v1/anonymize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          language,
          entities: entities.map(toApiEntity),
          ...(caseMap ? { case_map: caseMap } : {}),
          ...modeField(),
        }),
      }),
    anonymizeApiEntities: (text, entities, language = "pl", caseMap = null) =>
      requestJson<AnonymizeResponse>("/v1/anonymize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          language,
          entities,
          ...(caseMap ? { case_map: caseMap } : {}),
          ...modeField(),
        }),
      }),
    deanonymize: (text, replacementMap) =>
      requestJson<DeanonymizeResponse>("/v1/deanonymize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          replacement_map: replacementMap,
        }),
      }),
    listPrompts: () => requestJson<PromptTemplate[]>("/v1/prompts"),
    exportDocument: ({ anonymizedText, format, blocks }) =>
      requestBlob("/v1/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anonymized_text: anonymizedText,
          format,
          blocks,
        }),
      }),
    buildReport: (request) =>
      requestBlob("/v1/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
    exportDocxInPlace: ({ file, offsetMap, anonymizedText }) =>
      requestBlob("/v1/export/docx", {
        method: "POST",
        body: inPlaceExportForm(file, offsetMap, anonymizedText),
      }),
    cleanMetadata: async (file) => {
      const form = new FormData();
      form.append("file", file, file.name);
      const response = await fetcher(`${endpoint.baseUrl}/v1/metadata/clean`, {
        method: "POST",
        headers: { "X-Api-Key": endpoint.token },
        body: form,
      });
      if (!response.ok) {
        throw new ApiError(response, await readProblem(response));
      }
      const codes = (name: string) =>
        (response.headers.get(name) ?? "").split(",").filter((code) => code.length > 0);
      return {
        blob: await response.blob(),
        removed: codes("X-Poufnik-Removed"),
        notices: codes("X-Poufnik-Notices"),
      };
    },
    restoreDocxInPlace: ({ file, replacementMap }) => {
      // The map goes as a file part: plain multipart fields are capped at 1 MB.
      const form = new FormData();
      form.append("file", file, file.name);
      form.append(
        "replacement_map",
        new Blob([JSON.stringify(replacementMap)], { type: "application/json" }),
        "replacement_map.json",
      );
      return requestBlob("/v1/restore/docx", { method: "POST", body: form });
    },
    exportInPlace: ({ kind, file, offsetMap, anonymizedText }) =>
      requestBlob(`/v1/export/${kind}`, {
        method: "POST",
        body: inPlaceExportForm(file, offsetMap, anonymizedText),
      }),
    exportPdfInPlace: ({ file, offsetMap, anonymizedText, ocr }) => {
      const form = inPlaceExportForm(file, offsetMap, anonymizedText);
      form.append("ocr", String(ocr));
      return requestBlob("/v1/export/pdf", { method: "POST", body: form });
    },
  };
}

function inPlaceExportForm(
  file: File,
  offsetMap: OffsetMapEntry[],
  anonymizedText: string,
): FormData {
  // Text and offset map go as file parts: plain multipart fields are capped at 1 MB.
  const form = new FormData();
  form.append("file", file, file.name);
  form.append(
    "offset_map",
    new Blob([JSON.stringify(offsetMap)], { type: "application/json" }),
    "offset_map.json",
  );
  form.append(
    "anonymized_text",
    new Blob([anonymizedText], { type: "text/plain;charset=utf-8" }),
    "anonymized_text.txt",
  );
  // The "paint over faces" setting travels with every in-place export; the engine defaults to on.
  form.append("mask_faces", String(loadMaskFaces()));
  return form;
}

function toApiEntity(entity: DetectedEntity): Omit<DetectedEntity, "id"> {
  const apiEntity: Partial<DetectedEntity> = { ...entity };
  delete apiEntity.id;
  return apiEntity as Omit<DetectedEntity, "id">;
}

async function readProblem(response: Response): Promise<ApiProblem | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    return null;
  }

  try {
    return (await response.json()) as ApiProblem;
  } catch {
    return null;
  }
}
