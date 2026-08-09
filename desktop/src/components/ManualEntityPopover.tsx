import { useMemo, useState } from "react";

import { ENTITY_CATEGORY_ORDER } from "../domain/categories";
import { texts } from "../i18n";
import type {
  DocumentTextSelection,
  EntityCategory,
  EntityGroupSummary,
} from "../types";

interface ManualEntityPopoverProps {
  selection: DocumentTextSelection;
  groups: EntityGroupSummary[];
  onAdd: (category: EntityCategory, groupId: string | null) => void;
  onClose: () => void;
}

export function ManualEntityPopover({
  selection,
  groups,
  onAdd,
  onClose,
}: ManualEntityPopoverProps) {
  const [category, setCategory] = useState<EntityCategory>("CUSTOM");
  const [groupId, setGroupId] = useState("");
  const categoryGroups = useMemo(
    () => groups.filter((group) => group.category === category),
    [category, groups],
  );

  return (
    <div
      className="popover"
      role="dialog"
      aria-label={texts.corrections.addSensitive}
      style={{ left: selection.position.x, top: selection.position.y }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <div className="popover__header">
        <span className="caps-label">{texts.corrections.addSensitive}</span>
        <button
          className="icon-button icon-button--plain"
          type="button"
          aria-label={texts.corrections.close}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="popover__body">
        <p className="popover__snippet">{selection.text}</p>
        <p className="popover__meta">{texts.corrections.addHint}</p>

        <label className="field">
          <span>{texts.corrections.category}</span>
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as EntityCategory);
              setGroupId("");
            }}
          >
            {ENTITY_CATEGORY_ORDER.map((item) => (
              <option key={item} value={item}>
                {texts.categories[item]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{texts.corrections.group}</span>
          <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            <option value="">{texts.corrections.newGroup}</option>
            {categoryGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.token} · {group.canonicalText}
              </option>
            ))}
          </select>
        </label>

        <div className="popover__actions">
          <button className="ghost-button ghost-button--compact" type="button" onClick={onClose}>
            {texts.corrections.cancel}
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => onAdd(category, groupId || null)}
          >
            {texts.corrections.add}
          </button>
        </div>
      </div>
    </div>
  );
}
