import type {
  ApiDetectedEntity,
  DetectedEntity,
  DocumentSelectionRange,
  EntityCategory,
  EntityGroupSummary,
  EntityStatus,
} from "../types";

export function deriveEntityGroups(entities: DetectedEntity[]): EntityGroupSummary[] {
  const groups = new Map<
    string,
    Omit<EntityGroupSummary, "token"> & { tokenPrefix: string }
  >();

  for (const entity of entities) {
    const id = entity.entity_group_id;
    const label = entity.canonical_text ?? entity.text;
    const existing = groups.get(id);
    if (existing) {
      existing.count += 1;
      existing.acceptedCount += entity.status === "accepted" ? 1 : 0;
      existing.rejectedCount += entity.status === "rejected" ? 1 : 0;
      if (entity.start < existing.firstStart) {
        existing.firstStart = entity.start;
        existing.firstEntityId = entity.id;
      }
      continue;
    }
    groups.set(id, {
      id,
      category: entity.category as EntityCategory,
      label,
      canonicalText: label,
      count: 1,
      acceptedCount: entity.status === "accepted" ? 1 : 0,
      rejectedCount: entity.status === "rejected" ? 1 : 0,
      tokenPrefix: tokenPrefix(entity.category),
      firstEntityId: entity.id,
      firstStart: entity.start,
    });
  }

  const counters = new Map<string, number>();
  return [...groups.values()]
    .sort((left, right) => left.firstStart - right.firstStart || left.label.localeCompare(right.label))
    .map(({ tokenPrefix: prefix, ...group }) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return {
        ...group,
        token: `[${prefix}_${next}]`,
      };
    });
}

export function countByCategory(entities: DetectedEntity[]): Record<EntityCategory, number> {
  return entities.reduce(
    (accumulator, entity) => {
      accumulator[entity.category] = (accumulator[entity.category] ?? 0) + 1;
      return accumulator;
    },
    {} as Record<EntityCategory, number>,
  );
}

export function acceptedEntityCount(entities: DetectedEntity[]): number {
  return entities.filter((entity) => entity.status === "accepted").length;
}

export function normalizeEntitiesForUi(
  entities: ApiDetectedEntity[],
  documentText: string,
): DetectedEntity[] {
  return entities.map((entity, index) => {
    const text = documentText.slice(entity.start, entity.end) || entity.text;
    const category = entity.category;
    const canonical = entity.canonical_text ?? text;
    return {
      ...entity,
      id: entityId(entity, index),
      text,
      category,
      source: entity.source ?? "regex",
      status: entity.status ?? "accepted",
      entity_group_id: entity.entity_group_id ?? groupId(category, canonical),
      canonical_text: canonical,
    };
  });
}

export function createManualEntity(args: {
  documentText: string;
  range: DocumentSelectionRange;
  category: EntityCategory;
  group?: EntityGroupSummary | null;
}): DetectedEntity {
  const text = args.documentText.slice(args.range.start, args.range.end);
  const group = args.group;
  const id = `manual-${args.range.start}-${args.range.end}-${args.category}`;
  return {
    id,
    category: group?.category ?? args.category,
    start: args.range.start,
    end: args.range.end,
    text,
    confidence: 1,
    source: "manual",
    validation: "not_applicable",
    status: "accepted",
    entity_group_id: group?.id ?? `manual-group-${args.range.start}-${args.range.end}-${args.category}`,
    canonical_text: group?.canonicalText ?? text,
  };
}

export function groupId(category: EntityCategory, canonicalText: string): string {
  return `value:${category}:${canonicalText}`;
}

export function nextStatusForGroup(group: EntityGroupSummary): EntityStatus {
  return group.acceptedCount > 0 ? "rejected" : "accepted";
}

export function tokenPrefix(category: EntityCategory): string {
  const prefixes: Record<EntityCategory, string> = {
    PERSON: "OSOBA",
    COMPANY: "FIRMA",
    PUBLIC_INSTITUTION: "INSTYTUCJA",
    ADDRESS: "ADRES",
    PESEL: "PESEL",
    NIP: "NIP",
    REGON: "REGON",
    ID_CARD: "DOWOD",
    PASSPORT: "PASZPORT",
    KRS: "KRS",
    BANK_ACCOUNT: "RACHUNEK",
    PAYMENT_CARD: "KARTA",
    LAND_REGISTER: "KSIEGA_WIECZYSTA",
    PHONE: "TELEFON",
    EMAIL: "EMAIL",
    URL: "URL",
    IP_ADDRESS: "IP",
    MAC_ADDRESS: "MAC",
    API_KEY: "KLUCZ",
    VEHICLE: "POJAZD",
    CASE_NUMBER: "SYGNATURA",
    ADMIN_CASE: "ZNAK_SPRAWY",
    GPS: "GPS",
    MONEY: "KWOTA",
    DATE: "DATA",
    CUSTOM: "DANE",
  };
  return prefixes[category] ?? prefixes.CUSTOM;
}

function entityId(entity: ApiDetectedEntity, index: number): string {
  return `${entity.start}-${entity.end}-${entity.category}-${index}`;
}
