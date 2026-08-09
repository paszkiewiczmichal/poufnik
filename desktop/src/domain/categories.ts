import type { EntityCategory } from "../types";

export const ENTITY_CATEGORY_ORDER: EntityCategory[] = [
  "PERSON",
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
  "ADDRESS",
  "GPS",
  "COMPANY",
  "PUBLIC_INSTITUTION",
  "VEHICLE",
  "PHONE",
  "EMAIL",
  "URL",
  "IP_ADDRESS",
  "MAC_ADDRESS",
  "API_KEY",
  "DATE",
  "MONEY",
  "CUSTOM",
];

const RED_CATEGORIES = new Set<EntityCategory>([
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
const PURPLE_CATEGORIES = new Set<EntityCategory>([
  "PHONE",
  "EMAIL",
  "URL",
  "IP_ADDRESS",
  "MAC_ADDRESS",
  "API_KEY",
]);

export function categoryTone(category: EntityCategory): string {
  if (RED_CATEGORIES.has(category)) {
    return "red";
  }
  if (PURPLE_CATEGORIES.has(category)) {
    return "purple";
  }

  const tones: Partial<Record<EntityCategory, string>> = {
    PERSON: "yellow",
    ADDRESS: "blue",
    GPS: "blue",
    COMPANY: "green",
    PUBLIC_INSTITUTION: "gray",
    VEHICLE: "orange",
    DATE: "gray",
    MONEY: "gold",
    CUSTOM: "pink",
  };
  return tones[category] ?? "gray";
}

export function categoryClassName(category: EntityCategory): string {
  if (category === "PUBLIC_INSTITUTION") {
    return "highlight--public-institution";
  }
  return `highlight--${categoryTone(category)}`;
}

export function categoryMarker(category: EntityCategory): string {
  if (category === "PERSON") {
    return "P";
  }
  if (RED_CATEGORIES.has(category)) {
    return "#";
  }
  if (category === "ADDRESS") {
    return "A";
  }
  if (category === "GPS") {
    return "G";
  }
  if (category === "COMPANY") {
    return "F";
  }
  if (category === "PUBLIC_INSTITUTION") {
    return "I";
  }
  if (category === "VEHICLE") {
    return "V";
  }
  if (PURPLE_CATEGORIES.has(category)) {
    return "@";
  }
  if (category === "DATE") {
    return "D";
  }
  if (category === "MONEY") {
    return "$";
  }
  return "*";
}
