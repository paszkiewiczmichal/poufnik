import { beforeEach, describe, expect, it } from "vitest";

import { splitTextIntoBlocks } from "../domain/documentSegments";
import { deriveEntityGroups } from "../domain/entities";
import { selectionPointsToDocumentRange } from "../domain/selectionOffsets";
import type { DetectedEntity, ProcessedDocument } from "../types";
import { useAppStore } from "./useAppStore";

describe("useAppStore entity corrections", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  it("updates entity status locally", () => {
    setDocumentState("Jan Kowalski", [entity("e1", "PERSON", 0, 12, "Jan Kowalski", "p1")]);

    useAppStore.getState().setEntityStatus("e1", "rejected");

    expect(useAppStore.getState().entities[0].status).toBe("rejected");
    expect(useAppStore.getState().entityGroups[0].rejectedCount).toBe(1);
  });

  it("merges two groups into one token group", () => {
    setDocumentState("Jan Kowalski i Anna Nowak", [
      entity("e1", "PERSON", 0, 12, "Jan Kowalski", "p1"),
      entity("e2", "PERSON", 15, 25, "Anna Nowak", "p2"),
    ]);

    useAppStore.getState().mergeEntityGroups("p2", "p1");

    const state = useAppStore.getState();
    expect(state.entities.find((item) => item.id === "e2")?.entity_group_id).toBe("p1");
    expect(state.entityGroups).toHaveLength(1);
    expect(state.entityGroups[0].count).toBe(2);
  });

  it("creates a manual entity from a selection range in a 100+ page document", () => {
    const pages = Array.from({ length: 120 }, (_, index) =>
      index === 109 ? "Treść strony dane-wrażliwe koniec" : `Treść strony ${index + 1}`,
    );
    const text = pages.join("\f");
    setDocumentState(text, []);
    const targetBlock = splitTextIntoBlocks(text).find((block) => block.page === 110);
    expect(targetBlock).toBeDefined();
    const startInBlock = targetBlock!.text.indexOf("dane-wrażliwe");
    const range = selectionPointsToDocumentRange(
      { blockStart: targetBlock!.start, offsetInBlock: startInBlock },
      {
        blockStart: targetBlock!.start,
        offsetInBlock: startInBlock + "dane-wrażliwe".length,
      },
    );

    expect(range).not.toBeNull();
    useAppStore.getState().addManualEntity(range!, "CUSTOM", null);

    const manual = useAppStore.getState().entities[0];
    expect(manual.source).toBe("manual");
    expect(manual.start).toBe(targetBlock!.start + startInBlock);
    expect(manual.end).toBe(manual.start + "dane-wrażliwe".length);
    expect(manual.text).toBe("dane-wrażliwe");
  });

  it("restores a complete document session from history", () => {
    const restoredEntity = entity("e1", "PERSON", 0, 12, "Jan Kowalski", "p1");
    const replacementMap = {
      entries: [
        {
          token: "[OSOBA_1]",
          category: "PERSON",
          canonical_text: "Jan Kowalski",
          variants: ["Jan Kowalski"],
        },
      ],
      document_fingerprint: "abc",
    };

    useAppStore.getState().restoreDocumentSession({
      document: {
        filename: "historia.txt",
        format: "txt",
        source: "parsed",
        page_count: 1,
        text: "Jan Kowalski",
      },
      entities: [restoredEntity],
      anonymizedText: "[OSOBA_1]",
      replacementMap,
    });

    const state = useAppStore.getState();
    expect(state.document?.filename).toBe("historia.txt");
    expect(state.entities).toEqual([restoredEntity]);
    expect(state.entityGroups).toHaveLength(1);
    expect(state.anonymization.status).toBe("done");
    expect(state.anonymization.anonymizedText).toBe("[OSOBA_1]");
    expect(state.anonymization.offsetMap).toEqual([]);
    expect(state.deanonymization.replacementMap).toEqual(replacementMap);
    expect(state.uiState.selectedFile).toBeNull();
  });
});

function setDocumentState(text: string, entities: DetectedEntity[]): void {
  const document: ProcessedDocument = {
    filename: "test.txt",
    format: "txt",
    source: "parsed",
    page_count: 1,
    text,
  };
  useAppStore.setState({
    document,
    entities,
    entityGroups: deriveEntityGroups(entities),
  });
}

function entity(
  id: string,
  category: DetectedEntity["category"],
  start: number,
  end: number,
  text: string,
  groupId: string,
): DetectedEntity {
  return {
    id,
    category,
    start,
    end,
    text,
    confidence: 1,
    source: "ner",
    validation: "not_applicable",
    status: "accepted",
    entity_group_id: groupId,
    canonical_text: text,
  };
}
