import { ENTITY_CATEGORY_ORDER } from "../domain/categories";
import { countByCategory } from "../domain/entities";
import { texts } from "../i18n";
import { categoryDotClassName, categoryToneClassName } from "../ui/categoryPresentation";
import type { DetectedEntity, EntityCategory } from "../types";

interface CategoryLegendProps {
  entities: DetectedEntity[];
  hiddenCategories: EntityCategory[];
  onToggleCategory: (category: EntityCategory) => void;
  onRedetect: () => void;
  redetectDisabled: boolean;
  redetectLoading: boolean;
}

export function CategoryLegend({
  entities,
  hiddenCategories,
  onToggleCategory,
  onRedetect,
  redetectDisabled,
  redetectLoading,
}: CategoryLegendProps) {
  const counts = countByCategory(entities);
  const hidden = new Set(hiddenCategories);
  const total = entities.length;
  const present = ENTITY_CATEGORY_ORDER.filter(
    (category) => category !== "PUBLIC_INSTITUTION" && (counts[category] ?? 0) > 0,
  );

  return (
    <div className="legend" role="group" aria-label={texts.legend.title}>
      <span className="caps-label legend__label">{texts.review.showLabel}</span>
      {present.map((category) => {
        const isHidden = hidden.has(category);
        const count = counts[category] ?? 0;
        return (
          <label
            className={`legend-chip ${isHidden ? "legend-chip--off" : "legend-chip--on"} ${categoryToneClassName(category)}`}
            key={category}
          >
            <input
              type="checkbox"
              checked={!isHidden}
              onChange={() => onToggleCategory(category)}
              aria-label={`${isHidden ? texts.legend.showCategory : texts.legend.hideCategory}: ${
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
