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
  anonymize(text: string, entities: DetectedEntity[], language?: string): Promise<AnonymizeResponse>;
  anonymizeApiEntities(
    text: string,
    entities: ApiDetectedEntity[],
    language?: string,
  ): Promise<AnonymizeResponse>;
  deanonymize(text: string, replacementMap: ReplacementMap): Promise<DeanonymizeResponse>;
  listPrompts(): Promise<PromptTemplate[]>;
  exportDocument(options: {
    anonymizedText: string;
    format: ExportFormat;
    blocks?: ExportBlock[];
  }): Promise<Blob>;
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

    return response.blob();
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
        }),
      }),
    processDocument: (file, options) => {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("force_ocr", String(options.forceOcr));
      form.append("language", options.language ?? "pl");

      return requestJson<DocumentProcessResponse>("/v1/documents/process", {
        method: "POST",
        body: form,
      });
    },
    anonymize: (text, entities, language = "pl") =>
      requestJson<AnonymizeResponse>("/v1/anonymize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          language,
          entities: entities.map(toApiEntity),
        }),
      }),
    anonymizeApiEntities: (text, entities, language = "pl") =>
      requestJson<AnonymizeResponse>("/v1/anonymize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          language,
          entities,
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
  };
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
