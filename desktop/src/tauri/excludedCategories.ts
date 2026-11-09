import { ENTITY_CATEGORY_ORDER } from "../domain/categories";
import type { EntityCategory } from "../types";
import type { LocalStorageLike } from "./customRules";

const EXCLUDED_CATEGORIES_KEY = "anonymizer.excludedCategories.v1";

export function loadExcludedCategories(
  storage: LocalStorageLike = window.localStorage,
): EntityCategory[] {
  const raw = storage.getItem(EXCLUDED_CATEGORIES_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    // Unknown names (e.g. a category removed in a later version) are dropped.
    return ENTITY_CATEGORY_ORDER.filter((category) => parsed.includes(category));
  } catch {
    return [];
  }
}

export function saveExcludedCategories(
  categories: EntityCategory[],
  storage: LocalStorageLike = window.localStorage,
): void {
  storage.setItem(EXCLUDED_CATEGORIES_KEY, JSON.stringify(categories));
}
