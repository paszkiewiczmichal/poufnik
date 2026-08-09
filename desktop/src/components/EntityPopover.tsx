import { useState } from "react";

import { ENTITY_CATEGORY_ORDER } from "../domain/categories";
import { texts } from "../i18n";
import type { DetectedEntity, EntityCategory, EntityGroupSummary, PopoverPosition } from "../types";

interface EntityPopoverProps {
  entity: DetectedEntity;
  groups: EntityGroupSummary[];
  position: PopoverPosition;
  onStatusChange: (entityId: string, status: DetectedEntity["status"]) => void;
  onCategoryChange: (entityId: string, category: EntityCategory) => void;
  onAssignGroup: (entityId: string, groupId: string) => void;
  onCreateGroup: (entityId: string) => void;
  onMergeGroups: (sourceGroupId: string, targetGroupId: string) => void;
  onClose: () => void;
}

export function EntityPopover({
  entity,
  groups,
  position,
  onStatusChange,
  onCategoryChange,
  onAssignGroup,
  onCreateGroup,
  onMergeGroups,
  onClose,
}: EntityPopoverProps) {
  const [mergeTarget, setMergeTarget] = useState("");
  const group = groups.find((item) => item.id === entity.entity_group_id) ?? null;
  const groupsForCategory = groups.filter((item) => item.category === entity.category);
  const mergeCandidates = groupsForCategory.filter((item) => item.id !== entity.entity_group_id);
  const rejected = entity.status === "rejected";

  return (
    <div
      className="popover"
      role="dialog"
      aria-label={texts.corrections.popoverTitle}
      style={{ left: position.x, top: position.y }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <div className="popover__header">
        <span className="caps-label">{texts.corrections.popoverTitle}</span>
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
        <p className="popover__title">{entity.text}</p>
        <p className="popover__meta">
          {texts.categories[entity.category]}
          {group ? (
            <>
              {" · "}
              <span className="entity-card__token">{group.token}</span>
              {" · "}
              {texts.entities.occurrences(group.count)}
            </>
          ) : null}
        </p>

        {entity.validation === "failed" ? (
          <p className="entity-card__note">{texts.document.failedValidationTooltip}</p>
        ) : null}

        <label className="field">
          <span>{texts.corrections.category}</span>
          <select
            value={entity.category}
            onChange={(event) => onCategoryChange(entity.id, event.target.value as EntityCategory)}
          >
            {ENTITY_CATEGORY_ORDER.map((category) => (
              <option key={category} value={category}>
                {texts.categories[category]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{texts.corrections.group}</span>
          <select
            value={entity.entity_group_id}
            onChange={(event) => onAssignGroup(entity.id, event.target.value)}
          >
            {groupsForCategory.map((item) => (
              <option key={item.id} value={item.id}>
                {item.token} · {item.canonicalText}
              </option>
            ))}
          </select>
        </label>

        <button
          className="ghost-button ghost-button--compact"
          type="button"
          onClick={() => onCreateGroup(entity.id)}
        >
          {texts.corrections.createGroup}
        </button>

        {mergeCandidates.length > 0 ? (
          <>
            <label className="field">
              <span>{texts.corrections.mergeGroup}</span>
              <select value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
                <option value="">{texts.corrections.mergeGroup}</option>
                {mergeCandidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.token} · {item.canonicalText}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="ghost-button ghost-button--compact"
              type="button"
              disabled={!mergeTarget}
              onClick={() => {
                onMergeGroups(entity.entity_group_id, mergeTarget);
                setMergeTarget("");
              }}
            >
              {texts.corrections.merge}
            </button>
          </>
        ) : null}

        <button
          className="ghost-button"
          type="button"
          onClick={() => onStatusChange(entity.id, rejected ? "accepted" : "rejected")}
        >
          {rejected ? texts.corrections.restore : texts.corrections.reject}
        </button>

        <button className="primary-button" type="button" onClick={onClose}>
          {texts.corrections.done}
        </button>
      </div>
    </div>
  );
}
