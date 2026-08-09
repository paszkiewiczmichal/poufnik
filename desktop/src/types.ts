import type { components } from "./api/openapi";

export type ApiEntityCategory = components["schemas"]["EntityCategory"];
export type EntityCategory = ApiEntityCategory | "CUSTOM";
export type ValidationStatus = components["schemas"]["ValidationStatus"];
export type EntityStatus = "accepted" | "rejected";
export type EntitySource = "regex" | "dictionary" | "ner" | "manual";

export type ApiDetectedEntity = Omit<components["schemas"]["DetectedEntity"], "category"> & {
  category: EntityCategory;
};

export type DetectedEntity = Omit<
  components["schemas"]["DetectedEntity"],
  "category" | "source" | "status" | "entity_group_id" | "canonical_text"
> & {
  id: string;
  category: EntityCategory;
  source: EntitySource;
  status: EntityStatus;
  entity_group_id: string;
  canonical_text: string | null;
};

export type ProcessedDocument = components["schemas"]["ProcessedDocument"];
export type ReplacementMap = components["schemas"]["ReplacementMap"];
export type ReplacementEntry = components["schemas"]["ReplacementEntry"];
export type OffsetMapEntry = components["schemas"]["OffsetMapEntry"];
export type AnalyzeResponse = components["schemas"]["AnalyzeResponse"];
export type AnonymizeResponse = components["schemas"]["AnonymizeResponse"];
export type DeanonymizeResponse = components["schemas"]["DeanonymizeResponse"];
export type PromptTemplate = components["schemas"]["PromptTemplateResponse"];

export type DocumentProcessResponse = Omit<
  components["schemas"]["DocumentProcessResponse"],
  "entities"
> & {
  entities: ApiDetectedEntity[];
};

export interface EntityGroupSummary {
  id: string;
  category: EntityCategory;
  label: string;
  canonicalText: string;
  count: number;
  acceptedCount: number;
  rejectedCount: number;
  token: string;
  firstEntityId: string;
  firstStart: number;
}

export interface EngineEndpoint {
  port: number;
  token: string;
  baseUrl: string;
}

export type EngineHealthStatus = components["schemas"]["HealthResponse"]["status"];

export type EngineStatusEvent =
  | { status: "starting"; attempt: number }
  | { status: "ready"; endpoint: EngineEndpoint }
  | { status: "restarting"; attempt: number }
  | { status: "failed"; message: string };

export type ProcessingStep = "parsing" | "ocr" | "detecting";

export interface UiState {
  engineStatus: "starting" | "ready" | "restarting" | "failed";
  engineHealthStatus: EngineHealthStatus | null;
  engineError: string | null;
  endpoint: EngineEndpoint | null;
  processingStatus: "idle" | "loading" | "error";
  processingStep: ProcessingStep;
  processingError: string | null;
  forceOcr: boolean;
  hiddenCategories: EntityCategory[];
  selectedFileName: string | null;
  selectedFile: File | null;
}

export interface AnonymizationState {
  status: "idle" | "loading" | "error" | "done";
  error: string | null;
  anonymizedText: string | null;
  replacementMap: ReplacementMap | null;
  offsetMap: OffsetMapEntry[];
}

export interface RestoredDocumentSession {
  document: ProcessedDocument;
  entities: DetectedEntity[];
  anonymizedText: string;
  replacementMap: ReplacementMap;
  offsetMap?: OffsetMapEntry[];
}

export interface PromptState {
  status: "idle" | "loading" | "error" | "ready";
  error: string | null;
  items: PromptTemplate[];
  search: string;
  selectedId: string | null;
}

export interface DeanonymizationState {
  status: "idle" | "loading" | "error" | "done";
  error: string | null;
  input: string;
  result: string | null;
  warnings: string[];
  replacementMap: ReplacementMap | null;
}

export interface DocumentBlock {
  id: string;
  start: number;
  end: number;
  text: string;
  page: number;
}

export interface ExportBlock {
  start: number;
  end: number;
  kind: "paragraph" | "heading" | "table_cell" | "page_break";
  page: number | null;
}

export type ExportFormat = "docx" | "pdf";

export interface CustomRegexRule {
  id: string;
  name: string;
  pattern: string;
  label: string;
  enabled: boolean;
}

export interface CustomRegexRulePayload {
  name: string;
  pattern: string;
  label: string;
}

export type BatchQueueStatus = "queued" | "processing" | "done" | "error";

export interface BatchQueueItem {
  id: string;
  file: File;
  filename: string;
  size: number;
  status: BatchQueueStatus;
  entityCount: number | null;
  error: string | null;
  document: ProcessedDocument | null;
  anonymizedText: string | null;
  replacementMap: ReplacementMap | null;
}

export interface BatchProcessSuccess {
  document: ProcessedDocument;
  anonymizedText: string;
  replacementMap: ReplacementMap;
  entityCount: number;
}

export type TextSegment =
  | {
      type: "text";
      start: number;
      end: number;
      text: string;
    }
  | {
      type: "entity";
      start: number;
      end: number;
      text: string;
      entity: DetectedEntity;
    };

export interface DocumentSelectionRange {
  start: number;
  end: number;
}

export interface PopoverPosition {
  x: number;
  y: number;
}

export interface DocumentTextSelection {
  range: DocumentSelectionRange;
  text: string;
  position: PopoverPosition;
}
