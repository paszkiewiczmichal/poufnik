import { beforeEach, describe, expect, it } from "vitest";

import type {
  ApiDetectedEntity,
  DocumentProcessResponse,
  ProcessedDocument,
  RestoredDocumentSession,
} from "../types";
import { useAppStore } from "./useAppStore";

function resetStore() {
  useAppStore.setState({
    document: null,
    entities: [],
    entityGroups: [],
    anonymization: {
      status: "idle",
      error: null,
      anonymizedText: null,
      replacementMap: null,
      offsetMap: [],
    },
    prompts: { status: "idle", error: null, items: [], search: "", selectedId: null },
    deanonymization: {
      status: "idle",
      error: null,
      input: "",
      result: null,
      warnings: [],
      replacementMap: null,
      mapSource: null,
    },
    uiState: {
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
    },
  });
}

beforeEach(resetStore);

const DOCUMENT_TEXT = "Jan Kowalski i Anna Nowak mieszka w Warszawie";

function baseDocument(): ProcessedDocument {
  return {
    filename: "pismo.txt",
    format: "txt",
    source: "parsed",
    page_count: 1,
    text: DOCUMENT_TEXT,
  };
}

function baseEntities(): ApiDetectedEntity[] {
  return [
    {
      start: 0,
      end: 12,
      text: "Jan Kowalski",
      category: "PERSON",
      confidence: 0.9,
      validation: "not_applicable",
    },
    {
      start: 15,
      end: 25,
      text: "Anna Nowak",
      category: "PERSON",
      confidence: 0.9,
      validation: "not_applicable",
    },
  ];
}

function processDocument(): DocumentProcessResponse {
  return {
    document: baseDocument(),
    entities: baseEntities(),
    anonymized_text: DOCUMENT_TEXT,
    replacement_map: { document_fingerprint: "fp", entries: [] },
    offset_map: [],
  };
}

function loadDocument() {
  useAppStore.getState().setProcessedDocument(processDocument(), new File(["x"], "pismo.txt"));
}

describe("engine status actions", () => {
  it("setEngineStarting resets engine health and error", () => {
    useAppStore.setState({
      uiState: { ...useAppStore.getState().uiState, engineHealthStatus: "ok", engineError: "boom" },
    });

    useAppStore.getState().setEngineStarting();

    expect(useAppStore.getState().uiState.engineStatus).toBe("starting");
    expect(useAppStore.getState().uiState.engineHealthStatus).toBeNull();
    expect(useAppStore.getState().uiState.engineError).toBeNull();
  });

  it("setEngineRestarting sets status to restarting", () => {
    useAppStore.getState().setEngineRestarting();

    expect(useAppStore.getState().uiState.engineStatus).toBe("restarting");
  });

  it("setEngineReady stores the endpoint and clears the error", () => {
    const endpoint = { port: 1234, token: "tok", baseUrl: "http://127.0.0.1:1234" };

    useAppStore.getState().setEngineReady(endpoint);

    expect(useAppStore.getState().uiState.engineStatus).toBe("ready");
    expect(useAppStore.getState().uiState.endpoint).toEqual(endpoint);
    expect(useAppStore.getState().uiState.engineError).toBeNull();
  });

  it("setEngineHealthStatus updates only the health field", () => {
    useAppStore.getState().setEngineHealthStatus("degraded");

    expect(useAppStore.getState().uiState.engineHealthStatus).toBe("degraded");
  });

  it("setEngineFailed marks the engine failed and clears the endpoint", () => {
    useAppStore.getState().setEngineReady({ port: 1, token: "t", baseUrl: "http://127.0.0.1:1" });

    useAppStore.getState().setEngineFailed("nie można uruchomić silnika");

    expect(useAppStore.getState().uiState.engineStatus).toBe("failed");
    expect(useAppStore.getState().uiState.engineError).toBe("nie można uruchomić silnika");
    expect(useAppStore.getState().uiState.endpoint).toBeNull();
  });

  it("setForceOcr toggles the forceOcr flag", () => {
    useAppStore.getState().setForceOcr(true);
    expect(useAppStore.getState().uiState.forceOcr).toBe(true);

    useAppStore.getState().setForceOcr(false);
    expect(useAppStore.getState().uiState.forceOcr).toBe(false);
  });
});

describe("processing actions", () => {
  it("setProcessing marks loading with the given step", () => {
    useAppStore.getState().setProcessing("ocr");

    expect(useAppStore.getState().uiState.processingStatus).toBe("loading");
    expect(useAppStore.getState().uiState.processingStep).toBe("ocr");
    expect(useAppStore.getState().uiState.processingError).toBeNull();
  });

  it("setProcessingError marks the error state", () => {
    useAppStore.getState().setProcessingError("Tesseract OCR failed");

    expect(useAppStore.getState().uiState.processingStatus).toBe("error");
    expect(useAppStore.getState().uiState.processingError).toBe("Tesseract OCR failed");
  });
});

describe("setProcessedDocument", () => {
  it("normalizes entities, derives groups, and resets anonymization/deanonymization", () => {
    useAppStore.setState({
      anonymization: {
        status: "done",
        error: null,
        anonymizedText: "stary wynik",
        replacementMap: { document_fingerprint: "old", entries: [] },
        offsetMap: [],
      },
      deanonymization: {
        status: "done",
        error: null,
        input: "",
        result: "stare",
        warnings: [],
        replacementMap: { document_fingerprint: "old", entries: [] },
        mapSource: "file",
      },
    });

    const file = new File(["x"], "pismo.txt");
    useAppStore.getState().setProcessedDocument(processDocument(), file);

    const state = useAppStore.getState();
    expect(state.document?.filename).toBe("pismo.txt");
    expect(state.entities).toHaveLength(2);
    expect(state.entities[0].text).toBe("Jan Kowalski");
    expect(state.entityGroups).toHaveLength(2);
    expect(state.anonymization.status).toBe("idle");
    expect(state.anonymization.replacementMap).toBeNull();
    expect(state.deanonymization.replacementMap).toBeNull();
    expect(state.deanonymization.mapSource).toBeNull();
    expect(state.uiState.selectedFileName).toBe("pismo.txt");
    expect(state.uiState.selectedFile).toBe(file);
  });
});

describe("restoreDocumentSession", () => {
  it("restores a finished session and tags the map as session-sourced", () => {
    loadDocument();
    const entities = useAppStore.getState().entities;
    const session: RestoredDocumentSession = {
      document: baseDocument(),
      entities,
      anonymizedText: "wynik z historii",
      replacementMap: { document_fingerprint: "hist", entries: [] },
      offsetMap: [],
    };

    useAppStore.getState().restoreDocumentSession(session);

    const state = useAppStore.getState();
    expect(state.anonymization.status).toBe("done");
    expect(state.anonymization.anonymizedText).toBe("wynik z historii");
    expect(state.deanonymization.replacementMap).toEqual(session.replacementMap);
    expect(state.deanonymization.mapSource).toBe("session");
    expect(state.uiState.selectedFileName).toBe("pismo.txt");
    expect(state.uiState.selectedFile).toBeNull();
  });
});

describe("toggleCategory", () => {
  it("hides a category the first time and reveals it the second time", () => {
    useAppStore.getState().toggleCategory("PERSON");
    expect(useAppStore.getState().uiState.hiddenCategories).toEqual(["PERSON"]);

    useAppStore.getState().toggleCategory("PERSON");
    expect(useAppStore.getState().uiState.hiddenCategories).toEqual([]);
  });
});

describe("entity mutation actions", () => {
  it("setEntityStatus updates only the targeted entity", () => {
    loadDocument();
    const [first, second] = useAppStore.getState().entities;

    useAppStore.getState().setEntityStatus(first.id, "rejected");

    const state = useAppStore.getState();
    expect(state.entities.find((entity) => entity.id === first.id)?.status).toBe("rejected");
    expect(state.entities.find((entity) => entity.id === second.id)?.status).toBe("accepted");
  });

  it("setEntityCategory changes the category and regroups by the new canonical value", () => {
    loadDocument();
    const [first] = useAppStore.getState().entities;

    useAppStore.getState().setEntityCategory(first.id, "ADDRESS");

    const updated = useAppStore.getState().entities.find((entity) => entity.id === first.id);
    expect(updated?.category).toBe("ADDRESS");
    expect(updated?.entity_group_id).toBe("value:ADDRESS:Jan Kowalski");
  });

  it("assignEntityToGroup adopts the target group's category and canonical text", () => {
    loadDocument();
    const [first] = useAppStore.getState().entities;
    const [groupA, groupB] = useAppStore.getState().entityGroups;

    useAppStore.getState().assignEntityToGroup(first.id, groupB.id);

    const updated = useAppStore.getState().entities.find((entity) => entity.id === first.id);
    expect(updated?.entity_group_id).toBe(groupB.id);
    expect(updated?.canonical_text).toBe(groupB.canonicalText);
    expect(groupA.id).not.toBe(groupB.id);
  });

  it("assignEntityToGroup is a no-op when the target group id does not exist", () => {
    loadDocument();
    const [first] = useAppStore.getState().entities;
    const before = useAppStore.getState().entities;

    useAppStore.getState().assignEntityToGroup(first.id, "missing-group");

    expect(useAppStore.getState().entities).toEqual(before);
  });

  it("createGroupForEntity gives the entity its own manual group", () => {
    loadDocument();
    const [first] = useAppStore.getState().entities;

    useAppStore.getState().createGroupForEntity(first.id);

    const updated = useAppStore.getState().entities.find((entity) => entity.id === first.id);
    expect(updated?.entity_group_id).toBe(`manual-group-${first.id}`);
    expect(updated?.canonical_text).toBe(first.text);
  });

  it("setEntityGroupStatus updates every entity sharing the group id", () => {
    loadDocument();
    const [first, second] = useAppStore.getState().entities;
    const [groupA, groupB] = useAppStore.getState().entityGroups;
    useAppStore.getState().assignEntityToGroup(first.id, groupB.id);

    useAppStore.getState().setEntityGroupStatus(groupB.id, "rejected");

    const state = useAppStore.getState();
    expect(state.entities.find((entity) => entity.id === first.id)?.status).toBe("rejected");
    expect(state.entities.find((entity) => entity.id === second.id)?.status).toBe("rejected");
    expect(groupA.id).not.toBe(groupB.id);
  });

  it("mergeEntityGroups moves the source group's entities under the target group", () => {
    loadDocument();
    const [first] = useAppStore.getState().entities;
    const [groupA, groupB] = useAppStore.getState().entityGroups;

    useAppStore.getState().mergeEntityGroups(groupA.id, groupB.id);

    const updated = useAppStore.getState().entities.find((entity) => entity.id === first.id);
    expect(updated?.entity_group_id).toBe(groupB.id);
    expect(updated?.canonical_text).toBe(groupB.canonicalText);
  });

  it("mergeEntityGroups is a no-op when source and target are the same group", () => {
    loadDocument();
    const [groupA] = useAppStore.getState().entityGroups;
    const before = useAppStore.getState().entities;

    useAppStore.getState().mergeEntityGroups(groupA.id, groupA.id);

    expect(useAppStore.getState().entities).toEqual(before);
  });

  it("mergeEntityGroups is a no-op when the target group does not exist", () => {
    loadDocument();
    const [groupA] = useAppStore.getState().entityGroups;
    const before = useAppStore.getState().entities;

    useAppStore.getState().mergeEntityGroups(groupA.id, "missing-group");

    expect(useAppStore.getState().entities).toEqual(before);
  });
});

describe("addManualEntity", () => {
  it("does nothing when there is no loaded document", () => {
    useAppStore.getState().addManualEntity({ start: 0, end: 4 }, "ADDRESS");

    expect(useAppStore.getState().entities).toEqual([]);
  });

  it("adds a manual entity for the given range and category", () => {
    loadDocument();

    useAppStore.getState().addManualEntity({ start: 36, end: 45 }, "ADDRESS");

    const state = useAppStore.getState();
    const manual = state.entities.find((entity) => entity.source === "manual");
    expect(manual?.text).toBe("Warszawie");
    expect(manual?.category).toBe("ADDRESS");
    expect(manual?.status).toBe("accepted");
    expect(state.entityGroups.some((group) => group.canonicalText === "Warszawie")).toBe(true);
  });

  it("attaches the manual entity to an existing group when a groupId is given", () => {
    loadDocument();
    const [, groupB] = useAppStore.getState().entityGroups;

    useAppStore.getState().addManualEntity({ start: 36, end: 45 }, "ADDRESS", groupB.id);

    const manual = useAppStore.getState().entities.find((entity) => entity.source === "manual");
    expect(manual?.entity_group_id).toBe(groupB.id);
    expect(manual?.canonical_text).toBe(groupB.canonicalText);
    expect(manual?.category).toBe(groupB.category);
  });
});

describe("anonymization actions", () => {
  it("setAnonymizationLoading sets status to loading and clears the error", () => {
    useAppStore.getState().setAnonymizationError("boom");

    useAppStore.getState().setAnonymizationLoading();

    expect(useAppStore.getState().anonymization.status).toBe("loading");
    expect(useAppStore.getState().anonymization.error).toBeNull();
  });

  it("setAnonymizationError records the failure", () => {
    useAppStore.getState().setAnonymizationError("silnik nie odpowiada");

    expect(useAppStore.getState().anonymization.status).toBe("error");
    expect(useAppStore.getState().anonymization.error).toBe("silnik nie odpowiada");
  });

  it("setAnonymizationResult stores the result and tags the deanonymization map as session-sourced", () => {
    const replacementMap = { document_fingerprint: "fp", entries: [] };

    useAppStore.getState().setAnonymizationResult("[OSOBA_1] idzie do sądu.", replacementMap, [
      { original_start: 0, original_end: 3, anonymized_start: 0, anonymized_end: 9 },
    ]);

    const state = useAppStore.getState();
    expect(state.anonymization.status).toBe("done");
    expect(state.anonymization.anonymizedText).toBe("[OSOBA_1] idzie do sądu.");
    expect(state.anonymization.replacementMap).toBe(replacementMap);
    expect(state.deanonymization.replacementMap).toBe(replacementMap);
    expect(state.deanonymization.mapSource).toBe("session");
  });

  it("setAnonymizationResult defaults the offset map to an empty array", () => {
    useAppStore.getState().setAnonymizationResult("tekst", { document_fingerprint: "fp", entries: [] });

    expect(useAppStore.getState().anonymization.offsetMap).toEqual([]);
  });
});

describe("prompt actions", () => {
  const prompt1 = { id: "p1", name: "Wezwanie", description: "", category: "pismo", content: "" };
  const prompt2 = { id: "p2", name: "Pozew", description: "", category: "pismo", content: "" };

  it("setPromptsLoading / setPromptsError toggle status", () => {
    useAppStore.getState().setPromptsLoading();
    expect(useAppStore.getState().prompts.status).toBe("loading");

    useAppStore.getState().setPromptsError("brak połączenia");
    expect(useAppStore.getState().prompts.status).toBe("error");
    expect(useAppStore.getState().prompts.error).toBe("brak połączenia");
  });

  it("setPrompts selects the first prompt when none is selected yet", () => {
    useAppStore.getState().setPrompts([prompt1, prompt2] as never);

    const state = useAppStore.getState();
    expect(state.prompts.status).toBe("ready");
    expect(state.prompts.items).toHaveLength(2);
    expect(state.prompts.selectedId).toBe("p1");
  });

  it("setPrompts keeps the existing selection when one is already selected", () => {
    useAppStore.setState({
      prompts: { status: "idle", error: null, items: [], search: "", selectedId: "p2" },
    });

    useAppStore.getState().setPrompts([prompt1, prompt2] as never);

    expect(useAppStore.getState().prompts.selectedId).toBe("p2");
  });

  it("setPromptSearch and setSelectedPrompt update their fields directly", () => {
    useAppStore.getState().setPromptSearch("wezwanie");
    expect(useAppStore.getState().prompts.search).toBe("wezwanie");

    useAppStore.getState().setSelectedPrompt("p1");
    expect(useAppStore.getState().prompts.selectedId).toBe("p1");
  });
});

describe("deanonymization actions", () => {
  it("setDeanonymizationInput stores the raw input text", () => {
    useAppStore.getState().setDeanonymizationInput("[OSOBA_1] zlozyl pozew.");

    expect(useAppStore.getState().deanonymization.input).toBe("[OSOBA_1] zlozyl pozew.");
  });

  it("setDeanonymizationLoading / setDeanonymizationError toggle status", () => {
    useAppStore.getState().setDeanonymizationLoading();
    expect(useAppStore.getState().deanonymization.status).toBe("loading");

    useAppStore.getState().setDeanonymizationError("mapa jest uszkodzona");
    expect(useAppStore.getState().deanonymization.status).toBe("error");
    expect(useAppStore.getState().deanonymization.error).toBe("mapa jest uszkodzona");
  });

  it("setDeanonymizationResult stores the restored text and warnings", () => {
    useAppStore.getState().setDeanonymizationResult("Jan Kowalski zlozyl pozew.", ["1 wpis pominięty"]);

    const state = useAppStore.getState();
    expect(state.deanonymization.status).toBe("done");
    expect(state.deanonymization.result).toBe("Jan Kowalski zlozyl pozew.");
    expect(state.deanonymization.warnings).toEqual(["1 wpis pominięty"]);
  });

  it("setDeanonymizationMap tags the map source as file when loaded externally", () => {
    const replacementMap = { document_fingerprint: "fp", entries: [] };

    useAppStore.getState().setDeanonymizationMap(replacementMap, "file");

    const state = useAppStore.getState();
    expect(state.deanonymization.replacementMap).toBe(replacementMap);
    expect(state.deanonymization.mapSource).toBe("file");
  });
});

describe("resetDocument", () => {
  it("clears the document, entities, and anonymization/deanonymization state", () => {
    loadDocument();
    useAppStore.getState().setAnonymizationResult("tekst", { document_fingerprint: "fp", entries: [] });

    useAppStore.getState().resetDocument();

    const state = useAppStore.getState();
    expect(state.document).toBeNull();
    expect(state.entities).toEqual([]);
    expect(state.entityGroups).toEqual([]);
    expect(state.anonymization.status).toBe("idle");
    expect(state.deanonymization.mapSource).toBeNull();
    expect(state.uiState.selectedFileName).toBeNull();
    expect(state.uiState.selectedFile).toBeNull();
  });
});
