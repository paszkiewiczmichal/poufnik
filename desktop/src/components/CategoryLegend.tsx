import { ENTITY_CATEGORY_ORDER } from "../domain/categories";
import { countByCategory } from "../domain/entities";
import { texts } from "../i18n";
import { categoryDotClassName, categoryToneClassName } from "../ui/categoryPresentation";
import type { DetectedEntity, EntityCategory, EntityStatus } from "../types";

interface CategoryLegendProps {
  entities: DetectedEntity[];
  onSetCategoryStatus: (category: EntityCategory, status: EntityStatus) => void;
  onRedetect: () => void;
  redetectDisabled: boolean;
  redetectLoading: boolean;
}

export function CategoryLegend({
  entities,
  onSetCategoryStatus,
  onRedetect,
  redetectDisabled,
  redetectLoading,
}: CategoryLegendProps) {
  const counts = countByCategory(entities);
  // A category counts as anonymized while any of its items is still marked.
  const anonymized = new Set(
    entities.filter((entity) => entity.status === "accepted").map((entity) => entity.category),
  );
  const total = entities.length;
  const present = ENTITY_CATEGORY_ORDER.filter(
    (category) => category !== "PUBLIC_INSTITUTION" && (counts[category] ?? 0) > 0,
  );

  return (
    <div className="legend" role="group" aria-label={texts.legend.title}>
      <span className="caps-label legend__label">{texts.review.showLabel}</span>
      {present.map((category) => {
        const isOn = anonymized.has(category);
        const count = counts[category] ?? 0;
        return (
          <label
            className={`legend-chip ${isOn ? "legend-chip--on" : "legend-chip--off"} ${categoryToneClassName(category)}`}
            key={category}
          >
            <input
              type="checkbox"
              checked={isOn}
              onChange={() => onSetCategoryStatus(category, isOn ? "rejected" : "accepted")}
              aria-label={`${isOn ? texts.legend.excludeCategory : texts.legend.includeCategory}: ${
                texts.categories[category]
              }`}
            />
            <span className={categoryDotClassName(category)} aria-hidden="true" />
            <span>{texts.categories[category]}</span>
            <span aria-hidden="true">·</span>
            <span>{count}</span>
          </label>
        );
      })}
      <span className="legend__spacer" />
      <span className="legend__total">
        {texts.legend.total}: <strong>{total}</strong>
      </span>
      <button
        className="ghost-button ghost-button--compact"
        type="button"
        disabled={redetectDisabled}
        onClick={onRedetect}
      >
        {redetectLoading ? texts.processing.loading : texts.legend.redetect}
      </button>
    </div>
  );
}
