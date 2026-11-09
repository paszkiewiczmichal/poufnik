import { ENTITY_CATEGORY_ORDER } from "../domain/categories";
import { texts } from "../i18n";
import type { EntityCategory } from "../types";

interface ExcludedCategoriesSettingsProps {
  excluded: EntityCategory[];
  onChange: (excluded: EntityCategory[]) => void;
}

// Own rules have their own on/off switch in "Własne reguły".
const CATEGORIES = ENTITY_CATEGORY_ORDER.filter((category) => category !== "CUSTOM");

export function ExcludedCategoriesSettings({ excluded, onChange }: ExcludedCategoriesSettingsProps) {
  const off = new Set(excluded);

  const toggle = (category: EntityCategory, anonymize: boolean) => {
    const next = new Set(off);
    if (anonymize) {
      next.delete(category);
    } else {
      next.add(category);
    }
    onChange(ENTITY_CATEGORY_ORDER.filter((item) => next.has(item)));
  };

  return (
    <section className="settings-section">
      <h3>{texts.excludedCategories.heading}</h3>
      <p className="muted">{texts.excludedCategories.lead}</p>
      <div className="category-settings">
        {CATEGORIES.map((category) => (
          <label className="checkbox-row" key={category}>
            <input
              type="checkbox"
              checked={!off.has(category)}
              onChange={(event) => toggle(category, event.currentTarget.checked)}
            />
            <span>{texts.categories[category]}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
