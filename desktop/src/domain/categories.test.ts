import { describe, expect, it } from "vitest";

import type { EntityCategory } from "../types";
import { categoryClassName, categoryMarker, categoryTone, ENTITY_CATEGORY_ORDER } from "./categories";

describe("categoryTone", () => {
  it.each<[EntityCategory, string]>([
    ["PESEL", "red"],
    ["NIP", "red"],
    ["BANK_ACCOUNT", "red"],
    ["PHONE", "purple"],
    ["EMAIL", "purple"],
    ["API_KEY", "purple"],
    ["PERSON", "yellow"],
    ["ADDRESS", "blue"],
    ["GPS", "blue"],
    ["COMPANY", "green"],
    ["PUBLIC_INSTITUTION", "gray"],
    ["VEHICLE", "orange"],
    ["DATE", "gray"],
    ["MONEY", "gold"],
    ["CUSTOM", "pink"],
  ])("maps %s to %s", (category, expected) => {
    expect(categoryTone(category)).toBe(expected);
  });

  it("falls back to gray for a category with no explicit mapping", () => {
    expect(categoryTone("URL")).toBe("purple");
    expect(categoryTone("KRS")).toBe("red");
  });
});

describe("categoryClassName", () => {
  it("uses a dedicated class for PUBLIC_INSTITUTION", () => {
    expect(categoryClassName("PUBLIC_INSTITUTION")).toBe("highlight--public-institution");
  });

  it("derives the class name from the tone otherwise", () => {
    expect(categoryClassName("PERSON")).toBe("highlight--yellow");
    expect(categoryClassName("PESEL")).toBe("highlight--red");
  });
});

describe("categoryMarker", () => {
  it.each<[EntityCategory, string]>([
    ["PERSON", "P"],
    ["PESEL", "#"],
    ["NIP", "#"],
    ["ADDRESS", "A"],
    ["GPS", "G"],
    ["COMPANY", "F"],
    ["PUBLIC_INSTITUTION", "I"],
    ["VEHICLE", "V"],
    ["PHONE", "@"],
    ["EMAIL", "@"],
    ["DATE", "D"],
    ["MONEY", "$"],
    ["CUSTOM", "*"],
  ])("marks %s as %s", (category, expected) => {
    expect(categoryMarker(category)).toBe(expected);
  });
});

describe("ENTITY_CATEGORY_ORDER", () => {
  it("lists every category exactly once", () => {
    expect(new Set(ENTITY_CATEGORY_ORDER).size).toBe(ENTITY_CATEGORY_ORDER.length);
  });
});
