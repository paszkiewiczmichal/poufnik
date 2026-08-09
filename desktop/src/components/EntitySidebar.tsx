import { useMemo } from "react";
import type { MouseEvent } from "react";

import { ENTITY_CATEGORY_ORDER } from "../domain/categories";
import { texts } from "../i18n";
import { categoryDotClassName, categoryToneClassName } from "../ui/categoryPresentation";
import { CheckIcon } from "../ui/icons";
import type { DetectedEntity, EntityGroupSummary, PopoverPosition } from "../types";

interface EntitySidebarProps {
  entities: DetectedEntity[];
  groups: EntityGroupSummary[];
  onFocusEntity: (entityId: string) => void;
  onCorrectEntity: (entityId: string, position: PopoverPosition) => void;
  onSetGroupStatus: (groupId: string, status: "accepted" | "rejected") => void;
  publicInstitutionsExpanded: boolean;
  onPublicInstitutionsExpandedChange: (expanded: boolean) => void;
}

export function EntitySidebar({
  entities,
  groups,
  onFocusEntity,
  onCorrectEntity,
  onSetGroupStatus,
  publicInstitutionsExpanded,
  onPublicInstitutionsExpandedChange,
}: EntitySidebarProps) {
  const publicGroups = useMemo(
    () => groups.filter((group) => group.category === "PUBLIC_INSTITUTION"),
    [groups],
  );
  const grouped = useMemo(
    () =>
      ENTITY_CATEGORY_ORDER.filter((category) => category !== "PUBLIC_INSTITUTION")
        .map((category) => ({
          category,
          groups: groups.filter((group) => group.category === category),
        }))
        .filter((section) => section.groups.length > 0),
    [groups],
  );
  const unsureGroupIds = useMemo(
    () =>
      new Set(
        entities
          .filter((entity) => entity.validation === "failed")
          .map((entity) => entity.entity_group_id),
      ),
    [entities],
  );
  const hasGroups = grouped.length > 0 || publicGroups.length > 0;
  const markedPublicCount = publicGroups.filter((group) => group.acceptedCount > 0).length;

  return (
    <aside className="entity-panel" aria-labelledby="entity-panel-title">
      <div className="entity-panel__header">
        <h3 className="card-title" id="entity-panel-title">
          {texts.entities.heading}
        </h3>
        <p>{texts.entities.hint}</p>
      </div>

      {!hasGroups ? (
        <div className="entity-panel__empty">
          <span className="entity-panel__empty-icon" aria-hidden="true">
            <CheckIcon />
          </span>
          <h3>{texts.entities.emptyTitle}</h3>
          <p>{texts.entities.emptyBody}</p>
          <p>{texts.entities.emptyHint}</p>
        </div>
      ) : (
        <div>
          {grouped.map((section) => {
            const marked = section.groups.filter((group) => group.acceptedCount > 0).length;
            return (
              <section className="entity-section" key={section.category}>
                <div className={`entity-section__heading ${categoryToneClassName(section.category)}`}>
                  <span className={categoryDotClassName(section.category)} aria-hidden="true" />
                  <span className="entity-section__label">
                    {texts.categories[section.category]}
                  </span>
                  <span className="entity-section__count">
                    {texts.entities.groupCount(marked, section.groups.length)}
                  </span>
                </div>

                {section.groups.map((group) => (
                  <EntityGroupCard
                    group={group}
                    key={group.id}
                    unsure={unsureGroupIds.has(group.id)}
                    onFocusEntity={onFocusEntity}
                    onCorrectEntity={onCorrectEntity}
                    onSetGroupStatus={onSetGroupStatus}
                  />
                ))}
              </section>
            );
          })}
          {publicGroups.length > 0 && (
            <details
              className="entity-section entity-section--public"
              open={publicInstitutionsExpanded}
              onToggle={(event) => onPublicInstitutionsExpandedChange(event.currentTarget.open)}
            >
              <summary>
                <span className={categoryDotClassName("PUBLIC_INSTITUTION")} aria-hidden="true" />
                <span className={`entity-section__label ${categoryToneClassName("PUBLIC_INSTITUTION")}`}>
                  {texts.entities.publicInstitutionsTitle}
                </span>
                <span className="entity-section__count">
                  {texts.entities.groupCount(markedPublicCount, publicGroups.length)}
                </span>
              </summary>
              <p className="entity-section__hint">{texts.entities.publicInstitutionsHint}</p>
              {markedPublicCount < publicGroups.length && (
                <button
                  className="secondary-button secondary-button--compact"
                  type="button"
                  onClick={() =>
                    publicGroups.forEach((group) => onSetGroupStatus(group.id, "accepted"))
                  }
                >
                  {texts.entities.restorePublicInstitutions}
                </button>
              )}
              {publicGroups.map((group) => (
                <EntityGroupCard
                  group={group}
                  key={group.id}
                  unsure={unsureGroupIds.has(group.id)}
                  onFocusEntity={onFocusEntity}
                  onCorrectEntity={onCorrectEntity}
                  onSetGroupStatus={onSetGroupStatus}
                />
              ))}
            </details>
          )}
        </div>
      )}
    </aside>
  );
}

interface EntityGroupCardProps {
  group: EntityGroupSummary;
  unsure: boolean;
  onFocusEntity: (entityId: string) => void;
  onCorrectEntity: (entityId: string, position: PopoverPosition) => void;
  onSetGroupStatus: (groupId: string, status: "accepted" | "rejected") => void;
}

function EntityGroupCard({
  group,
  unsure,
  onFocusEntity,
  onCorrectEntity,
  onSetGroupStatus,
}: EntityGroupCardProps) {
  const marked = group.acceptedCount > 0;

  const openCorrection = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onCorrectEntity(group.firstEntityId, { x: rect.right, y: rect.bottom + 8 });
  };

  return (
    <article className={`entity-card ${marked ? "" : "entity-card--rejected"}`}>
      <input
        type="checkbox"
        checked={marked}
        onChange={(event) =>
          onSetGroupStatus(group.id, event.currentTarget.checked ? "accepted" : "rejected")
        }
        aria-label={`${texts.entities.include}: ${group.canonicalText}`}
      />
      <button
        className="entity-card__main"
        type="button"
        onClick={() => onFocusEntity(group.firstEntityId)}
      >
        <span className="entity-card__label">
          {group.canonicalText}
          {unsure ? <span className="unsure-badge">{texts.entities.uncertain}</span> : null}
        </span>
        <span className="entity-card__meta">
          {texts.categories[group.category]} ·{" "}
          <span className="entity-card__token">{group.token}</span> ·{" "}
          {texts.entities.occurrences(group.count)}
        </span>
        {unsure ? (
          <span className="entity-card__note">{texts.document.failedValidationTooltip}</span>
        ) : null}
      </button>
      <button className="link-button" type="button" onClick={openCorrection}>
        {texts.entities.correct}
      </button>
    </article>
  );
}
