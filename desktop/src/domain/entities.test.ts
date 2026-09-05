import { describe, expect, it } from "vitest";

import type { ApiDetectedEntity, DetectedEntity, EntityGroupSummary } from "../types";
import {
  acceptedEntityCount,
  countByCategory,
  createManualEntity,
  deriveEntityGroups,
  groupId,
  nextStatusForGroup,
  normalizeEntitiesForUi,
  tokenPrefix,
} from "./entities";

function entity(overrides: Partial<DetectedEntity> = {}): DetectedEntity {
  return {
    id: "e1",
    category: "PERSON",
    start: 0,
    end: 12,
    text: "Jan Kowalski",
    confidence: 0.9,
    source: "ner",
    validation: "not_applicable",
    status: "accepted",
    entity_group_id: "value:PERSON:Jan Kowalski",
    canonical_text: "Jan Kowalski",
    ...overrides,
  };
}

describe("deriveEntityGroups", () => {
  it("groups entities sharing the same entity_group_id and counts accepted/rejected", () => {
    const groups = deriveEntityGroups([
      entity({ id: "e1", start: 0, status: "accepted" }),
      entity({ id: "e2", start: 20, status: "rejected" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, acceptedCount: 1, rejectedCount: 1 });
  });

  it("moves firstStart/firstEntityId back when a later-added entity starts earlier", () => {
    const groups = deriveEntityGroups([
      entity({ id: "e-later", start: 50 }),
      entity({ id: "e-earlier", start: 5 }),
    ]);

    expect(groups[0].firstStart).toBe(5);
    expect(groups[0].firstEntityId).toBe("e-earlier");
  });

  it("sorts groups by firstStart, then assigns sequential tokens per category prefix", () => {
    const groups = deriveEntityGroups([
      entity({ id: "e1", start: 30, category: "PERSON", canonical_text: "Anna Nowak", entity_group_id: "g-anna" }),
      entity({ id: "e2", start: 0, category: "PERSON", canonical_text: "Jan Kowalski", entity_group_id: "g-jan" }),
    ]);

    expect(groups.map((group) => group.canonicalText)).toEqual(["Jan Kowalski", "Anna Nowak"]);
    expect(groups.map((group) => group.token)).toEqual(["[OSOBA_1]", "[OSOBA_2]"]);
  });

  it("breaks ties on the same firstStart by label", () => {
    const groups = deriveEntityGroups([
      entity({ id: "e1", start: 0, canonical_text: "Zenon", entity_group_id: "g-z" }),
      entity({ id: "e2", start: 0, canonical_text: "Adam", entity_group_id: "g-a" }),
    ]);

    expect(groups.map((group) => group.canonicalText)).toEqual(["Adam", "Zenon"]);
  });
});

describe("countByCategory / acceptedEntityCount", () => {
  it("counts entities per category", () => {
    const counts = countByCategory([
      entity({ category: "PERSON" }),
      entity({ category: "PERSON" }),
      entity({ category: "ADDRESS" }),
    ]);

    expect(counts.PERSON).toBe(2);
    expect(counts.ADDRESS).toBe(1);
  });

  it("counts only accepted entities", () => {
    const count = acceptedEntityCount([
      entity({ status: "accepted" }),
      entity({ status: "rejected" }),
      entity({ status: "accepted" }),
    ]);

    expect(count).toBe(2);
  });
});

describe("normalizeEntitiesForUi", () => {
  it("slices the entity text from the document and fills in UI defaults", () => {
    const apiEntities: ApiDetectedEntity[] = [
      { start: 0, end: 12, text: "stale-text", category: "PERSON", confidence: 0.8, validation: "not_applicable" },
    ];

    const normalized = normalizeEntitiesForUi(apiEntities, "Jan Kowalski zlozyl pozew.");

    expect(normalized[0].text).toBe("Jan Kowalski");
    expect(normalized[0].source).toBe("regex");
    expect(normalized[0].status).toBe("accepted");
    expect(normalized[0].canonical_text).toBe("Jan Kowalski");
    expect(normalized[0].entity_group_id).toBe(groupId("PERSON", "Jan Kowalski"));
    expect(normalized[0].id).toBe("0-12-PERSON-0");
  });

  it("preserves an explicit source, status, canonical_text, and entity_group_id when provided", () => {
    const apiEntities: ApiDetectedEntity[] = [
      {
        start: 0,
        end: 12,
        text: "Jan Kowalski",
        category: "PERSON",
        confidence: 0.8,
        validation: "not_applicable",
        source: "manual",
        status: "rejected",
        canonical_text: "J. Kowalski",
        entity_group_id: "custom-group",
      },
    ];

    const normalized = normalizeEntitiesForUi(apiEntities, "Jan Kowalski zlozyl pozew.");

    expect(normalized[0].source).toBe("manual");
    expect(normalized[0].status).toBe("rejected");
    expect(normalized[0].canonical_text).toBe("J. Kowalski");
    expect(normalized[0].entity_group_id).toBe("custom-group");
  });
});

describe("createManualEntity", () => {
  it("builds a standalone manual entity when no group is given", () => {
    const manual = createManualEntity({
      documentText: "Jan Kowalski mieszka w Warszawie.",
      range: { start: 23, end: 32 },
      category: "ADDRESS",
    });

    expect(manual).toMatchObject({
      category: "ADDRESS",
      text: "Warszawie",
      source: "manual",
      status: "accepted",
      canonical_text: "Warszawie",
      entity_group_id: "manual-group-23-32-ADDRESS",
    });
  });

  it("attaches the manual entity to an existing group when one is given", () => {
    const group: EntityGroupSummary = {
      id: "g-warszawa",
      category: "ADDRESS",
      label: "Warszawa",
      canonicalText: "Warszawa",
      count: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      token: "[ADRES_1]",
      firstEntityId: "e1",
      firstStart: 0,
    };

    const manual = createManualEntity({
      documentText: "Jan Kowalski mieszka w Warszawie.",
      range: { start: 23, end: 32 },
      category: "ADDRESS",
      group,
    });

    expect(manual.category).toBe(group.category);
    expect(manual.entity_group_id).toBe(group.id);
    expect(manual.canonical_text).toBe(group.canonicalText);
  });
});

describe("nextStatusForGroup", () => {
  it("proposes rejecting a group that has at least one accepted entity", () => {
    expect(nextStatusForGroup({ acceptedCount: 2 } as EntityGroupSummary)).toBe("rejected");
  });

  it("proposes accepting a group with no accepted entities", () => {
    expect(nextStatusForGroup({ acceptedCount: 0 } as EntityGroupSummary)).toBe("accepted");
  });
});

describe("tokenPrefix", () => {
  it("maps known categories to their token prefix", () => {
    expect(tokenPrefix("PERSON")).toBe("OSOBA");
    expect(tokenPrefix("PESEL")).toBe("PESEL");
    expect(tokenPrefix("CUSTOM")).toBe("DANE");
  });
});
