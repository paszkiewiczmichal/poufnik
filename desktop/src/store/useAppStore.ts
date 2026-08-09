import { create } from "zustand";

import {
  createManualEntity,
  deriveEntityGroups,
  groupId,
  normalizeEntitiesForUi,
} from "../domain/entities";
import type {
  AnonymizationState,
  DeanonymizationState,
  DetectedEntity,
  DocumentSelectionRange,
  DocumentProcessResponse,
  EntityCategory,
  EntityGroupSummary,
  EntityStatus,
  OffsetMapEntry,
  PromptState,
  ProcessedDocument,
  ProcessingStep,
  ReplacementMap,
  RestoredDocumentSession,
  UiState,
} from "../types";

interface AppStore {
  document: ProcessedDocument | null;
  entities: DetectedEntity[];
  entityGroups: EntityGroupSummary[];
  anonymization: AnonymizationState;
  prompts: PromptState;
  deanonymization: DeanonymizationState;
  uiState: UiState;
  setEngineStarting: () => void;
  setEngineRestarting: () => void;
  setEngineReady: (endpoint: UiState["endpoint"]) => void;
  setEngineHealthStatus: (status: UiState["engineHealthStatus"]) => void;
  setEngineFailed: (message: string) => void;
  setForceOcr: (forceOcr: boolean) => void;
  setProcessing: (step: ProcessingStep) => void;
  setProcessingError: (message: string) => void;
  setProcessedDocument: (response: DocumentProcessResponse, file: File) => void;
  restoreDocumentSession: (session: RestoredDocumentSession) => void;
  toggleCategory: (category: EntityCategory) => void;
  setEntityStatus: (entityId: string, status: EntityStatus) => void;
  setEntityCategory: (entityId: string, category: EntityCategory) => void;
  assignEntityToGroup: (entityId: string, groupId: string) => void;
  createGroupForEntity: (entityId: string) => void;
  addManualEntity: (
    range: DocumentSelectionRange,
    category: EntityCategory,
    groupId?: string | null,
  ) => void;
  setEntityGroupStatus: (groupId: string, status: EntityStatus) => void;
  mergeEntityGroups: (sourceGroupId: string, targetGroupId: string) => void;
  setAnonymizationLoading: () => void;
  setAnonymizationError: (message: string) => void;
  setAnonymizationResult: (
    anonymizedText: string,
    replacementMap: ReplacementMap,
    offsetMap?: OffsetMapEntry[],
  ) => void;
  setPromptsLoading: () => void;
  setPromptsError: (message: string) => void;
  setPrompts: (prompts: PromptState["items"]) => void;
  setPromptSearch: (search: string) => void;
  setSelectedPrompt: (id: string | null) => void;
  setDeanonymizationInput: (input: string) => void;
  setDeanonymizationLoading: () => void;
  setDeanonymizationError: (message: string) => void;
  setDeanonymizationResult: (result: string, warnings: string[]) => void;
  setDeanonymizationMap: (replacementMap: ReplacementMap | null) => void;
  resetDocument: () => void;
}

const initialUiState: UiState = {
  engineStatus: "starting",
  engineHealthStatus: null,
  engineError: null,
  endpoint: null,
  processingStatus: "idle",
  processingStep: "parsing",
  processingError: null,
  forceOcr: false,
  hiddenCategories: [],
  selectedFileName: null,
  selectedFile: null,
};

const initialAnonymization: AnonymizationState = {
  status: "idle",
  error: null,
  anonymizedText: null,
  replacementMap: null,
  offsetMap: [],
};

const initialPrompts: PromptState = {
  status: "idle",
  error: null,
  items: [],
  search: "",
  selectedId: null,
};

const initialDeanonymization: DeanonymizationState = {
  status: "idle",
  error: null,
  input: "",
  result: null,
  warnings: [],
  replacementMap: null,
};

export const useAppStore = create<AppStore>((set) => ({
  document: null,
  entities: [],
  entityGroups: [],
  anonymization: initialAnonymization,
  prompts: initialPrompts,
  deanonymization: initialDeanonymization,
  uiState: initialUiState,
  setEngineStarting: () =>
    set((state) => ({
      uiState: {
        ...state.uiState,
        engineStatus: "starting",
        engineHealthStatus: null,
        engineError: null,
      },
    })),
  setEngineRestarting: () =>
    set((state) => ({
      uiState: {
        ...state.uiState,
        engineStatus: "restarting",
        engineHealthStatus: null,
        engineError: null,
      },
    })),
  setEngineReady: (endpoint) =>
    set((state) => ({
      uiState: { ...state.uiState, engineStatus: "ready", engineError: null, endpoint },
    })),
  setEngineHealthStatus: (status) =>
    set((state) => ({
      uiState: { ...state.uiState, engineHealthStatus: status },
    })),
  setEngineFailed: (message) =>
    set((state) => ({
      uiState: {
        ...state.uiState,
        engineStatus: "failed",
        engineHealthStatus: null,
        engineError: message,
        endpoint: null,
      },
    })),
  setForceOcr: (forceOcr) =>
    set((state) => ({
      uiState: { ...state.uiState, forceOcr },
    })),
  setProcessing: (step) =>
    set((state) => ({
      uiState: {
        ...state.uiState,
        processingStatus: "loading",
        processingStep: step,
        processingError: null,
      },
    })),
  setProcessingError: (message) =>
    set((state) => ({
      uiState: {
        ...state.uiState,
        processingStatus: "error",
        processingError: message,
      },
    })),
  setProcessedDocument: (response, file) =>
    set((state) => {
      const entities = normalizeEntitiesForUi(response.entities, response.document.text);
      return {
        document: response.document,
        entities,
        entityGroups: deriveEntityGroups(entities),
        anonymization: {
          status: "idle",
          error: null,
          anonymizedText: null,
          replacementMap: null,
          offsetMap: [],
        },
        deanonymization: {
          ...initialDeanonymization,
          replacementMap: null,
        },
        uiState: {
          ...state.uiState,
          processingStatus: "idle",
          processingError: null,
          selectedFileName: file.name,
          selectedFile: file,
        },
      };
    }),
  restoreDocumentSession: (session) =>
    set((state) => ({
      document: session.document,
      entities: session.entities,
      entityGroups: deriveEntityGroups(session.entities),
      anonymization: {
        status: "done",
        error: null,
        anonymizedText: session.anonymizedText,
        replacementMap: session.replacementMap,
        offsetMap: session.offsetMap ?? [],
      },
      deanonymization: {
        ...initialDeanonymization,
        replacementMap: session.replacementMap,
      },
      uiState: {
        ...state.uiState,
        processingStatus: "idle",
        processingError: null,
        selectedFileName: session.document.filename,
        selectedFile: null,
      },
    })),
  toggleCategory: (category) =>
    set((state) => {
      const hidden = new Set(state.uiState.hiddenCategories);
      if (hidden.has(category)) {
        hidden.delete(category);
      } else {
        hidden.add(category);
      }
      return {
        uiState: {
          ...state.uiState,
          hiddenCategories: [...hidden],
        },
      };
    }),
  setEntityStatus: (entityId, status) =>
    set((state) => updateEntities(state, (entity) =>
      entity.id === entityId ? { ...entity, status } : entity,
    )),
  setEntityCategory: (entityId, category) =>
    set((state) =>
      updateEntities(state, (entity) => {
        if (entity.id !== entityId) {
          return entity;
        }
        const canonical = entity.text;
        return {
          ...entity,
          category,
          canonical_text: canonical,
          entity_group_id: groupId(category, canonical),
        };
      }),
    ),
  assignEntityToGroup: (entityId, groupIdValue) =>
    set((state) =>
      updateEntities(state, (entity) => {
        if (entity.id !== entityId) {
          return entity;
        }
        const group = state.entityGroups.find((item) => item.id === groupIdValue);
        if (!group) {
          return entity;
        }
        return {
          ...entity,
          category: group.category,
          entity_group_id: group.id,
          canonical_text: group.canonicalText,
        };
      }),
    ),
  createGroupForEntity: (entityId) =>
    set((state) =>
      updateEntities(state, (entity) =>
        entity.id === entityId
          ? {
              ...entity,
              canonical_text: entity.text,
              entity_group_id: `manual-group-${entity.id}`,
            }
          : entity,
      ),
    ),
  addManualEntity: (range, category, groupIdValue) =>
    set((state) => {
      if (!state.document) {
        return state;
      }
      const group = groupIdValue
        ? state.entityGroups.find((item) => item.id === groupIdValue)
        : null;
      const entity = createManualEntity({
        documentText: state.document.text,
        range,
        category,
        group,
      });
      return withEntities(state, [...state.entities, entity]);
    }),
  setEntityGroupStatus: (groupIdValue, status) =>
    set((state) =>
      updateEntities(state, (entity) =>
        entity.entity_group_id === groupIdValue ? { ...entity, status } : entity,
      ),
    ),
  mergeEntityGroups: (sourceGroupId, targetGroupId) =>
    set((state) => {
      const target = state.entityGroups.find((group) => group.id === targetGroupId);
      if (!target || sourceGroupId === targetGroupId) {
        return state;
      }
      return updateEntities(state, (entity) =>
        entity.entity_group_id === sourceGroupId
          ? {
              ...entity,
              category: target.category,
              entity_group_id: target.id,
              canonical_text: target.canonicalText,
            }
          : entity,
      );
    }),
  setAnonymizationLoading: () =>
    set((state) => ({
      anonymization: { ...state.anonymization, status: "loading", error: null },
    })),
  setAnonymizationError: (message) =>
    set((state) => ({
      anonymization: { ...state.anonymization, status: "error", error: message },
    })),
  setAnonymizationResult: (anonymizedText, replacementMap, offsetMap = []) =>
    set((state) => ({
      anonymization: {
        ...state.anonymization,
        status: "done",
        error: null,
        anonymizedText,
        replacementMap,
        offsetMap,
      },
      deanonymization: {
        ...state.deanonymization,
        replacementMap,
      },
    })),
  setPromptsLoading: () =>
    set((state) => ({
      prompts: { ...state.prompts, status: "loading", error: null },
    })),
  setPromptsError: (message) =>
    set((state) => ({
      prompts: { ...state.prompts, status: "error", error: message },
    })),
  setPrompts: (prompts) =>
    set((state) => ({
      prompts: {
        ...state.prompts,
        status: "ready",
        error: null,
        items: prompts,
        selectedId: state.prompts.selectedId ?? prompts[0]?.id ?? null,
      },
    })),
  setPromptSearch: (search) =>
    set((state) => ({
      prompts: { ...state.prompts, search },
    })),
  setSelectedPrompt: (id) =>
    set((state) => ({
      prompts: { ...state.prompts, selectedId: id },
    })),
  setDeanonymizationInput: (input) =>
    set((state) => ({
      deanonymization: { ...state.deanonymization, input },
    })),
  setDeanonymizationLoading: () =>
    set((state) => ({
      deanonymization: { ...state.deanonymization, status: "loading", error: null },
    })),
  setDeanonymizationError: (message) =>
    set((state) => ({
      deanonymization: { ...state.deanonymization, status: "error", error: message },
    })),
  setDeanonymizationResult: (result, warnings) =>
    set((state) => ({
      deanonymization: {
        ...state.deanonymization,
        status: "done",
        error: null,
        result,
        warnings,
      },
    })),
  setDeanonymizationMap: (replacementMap) =>
    set((state) => ({
      deanonymization: { ...state.deanonymization, replacementMap },
    })),
  resetDocument: () =>
    set((state) => ({
      document: null,
      entities: [],
      entityGroups: [],
      anonymization: initialAnonymization,
      deanonymization: initialDeanonymization,
      uiState: {
        ...state.uiState,
        processingStatus: "idle",
        processingError: null,
        selectedFileName: null,
        selectedFile: null,
      },
    })),
}));

type AppStoreSnapshot = Pick<
  AppStore,
  "entities" | "entityGroups" | "anonymization" | "deanonymization"
>;

function updateEntities(
  state: AppStoreSnapshot,
  updater: (entity: DetectedEntity) => DetectedEntity,
): Partial<AppStore> {
  return withEntities(state, state.entities.map(updater));
}

function withEntities(
  state: AppStoreSnapshot,
  entities: DetectedEntity[],
): Partial<AppStore> {
  return {
    entities,
    entityGroups: deriveEntityGroups(entities),
    anonymization: {
      ...state.anonymization,
      status: state.anonymization.status === "loading" ? "loading" : "idle",
      error: null,
    },
    deanonymization: {
      ...state.deanonymization,
      result: null,
      warnings: [],
    },
  };
}
