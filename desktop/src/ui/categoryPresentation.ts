import type { EntityCategory } from "../types";

// Prezentacyjne mapowanie kategorii wykrytych danych na klucze stylów Gabinet.
// Kolory par definiują tokeny --cat-<klucz>-* w App.css; tu tylko przypisanie klas.

export type CategoryStyleKey =
  | "person"
  | "id"
  | "address"
  | "company"
  | "contact"
  | "date"
  | "institution"
  | "vehicle"
  | "technical"
  | "money"
  | "custom";

const ID_CATEGORIES = new Set<EntityCategory>([
  "PESEL",
  "NIP",
  "REGON",
  "ID_CARD",
  "PASSPORT",
  "KRS",
  "LAND_REGISTER",
  "CASE_NUMBER",
  "ADMIN_CASE",
  "BANK_ACCOUNT",
  "PAYMENT_CARD",
]);
const CONTACT_CATEGORIES = new Set<EntityCategory>(["PHONE", "EMAIL", "URL"]);
const TECHNICAL_CATEGORIES = new Set<EntityCategory>([
  "IP_ADDRESS",
  "MAC_ADDRESS",
  "API_KEY",
]);

export function categoryStyleKey(category: EntityCategory): CategoryStyleKey {
  if (ID_CATEGORIES.has(category)) {
    return "id";
  }
  if (CONTACT_CATEGORIES.has(category)) {
    return "contact";
  }
  if (TECHNICAL_CATEGORIES.has(category)) {
    return "technical";
  }
  const keys: Partial<Record<EntityCategory, CategoryStyleKey>> = {
    PERSON: "person",
    ADDRESS: "address",
    GPS: "address",
    COMPANY: "company",
    PUBLIC_INSTITUTION: "institution",
    VEHICLE: "vehicle",
    DATE: "date",
    MONEY: "money",
    CUSTOM: "custom",
  };
  return keys[category] ?? "custom";
}

/** Klasa ustawiająca zmienne --chip-* dla chipów, kropek i nagłówków grup. */
export function categoryToneClassName(category: EntityCategory): string {
  return `cat--${categoryStyleKey(category)}`;
}

/** Klasa kropki kategorii (instytucje mają kropkowany kontur zamiast wypełnienia). */
export function categoryDotClassName(category: EntityCategory): string {
  const base = `cat-dot cat--${categoryStyleKey(category)}`;
  return category === "PUBLIC_INSTITUTION" ? `${base} cat-dot--institution` : base;
}

/** Klasy podświetlenia w tekście dokumentu. */
export function categoryClassName(category: EntityCategory): string {
  if (category === "PUBLIC_INSTITUTION") {
    return "highlight--public-institution";
  }
  return `cat--${categoryStyleKey(category)}`;
}
