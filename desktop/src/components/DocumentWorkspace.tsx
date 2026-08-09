import { useMemo, useState } from "react";

import { acceptedEntityCount } from "../domain/entities";
import { texts } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import type {
  AnonymizationState,
  DeanonymizationState,
  DetectedEntity,
  DocumentTextSelection,
  EntityCategory,
  EntityGroupSummary,
  ExportFormat,
  PopoverPosition,
  ProcessedDocument,
  PromptState,
} from "../types";
import { CategoryLegend } from "./CategoryLegend";
import { ComparisonView } from "./ComparisonView";
import { DocumentView } from "./DocumentView";
import { EntityPopover } from "./EntityPopover";
import { EntitySidebar } from "./EntitySidebar";
import { ManualEntityPopover } from "./ManualEntityPopover";
import { ResultView } from "./ResultView";
import { TierGate } from "./TierGate";

export type WorkspaceView = "document" | "result" | "compare";

interface DocumentWorkspaceProps {
  document: ProcessedDocument;
  entities: DetectedEntity[];
  entityGroups: EntityGroupSummary[];
  hiddenCategories: EntityCategory[];
  anonymization: AnonymizationState;
  prompts: PromptState;
  deanonymization: DeanonymizationState;
  processingStatus: "idle" | "loading" | "error";
  processingError: string | null;
  tier: "basic" | "early_bird";
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  onToggleCategory: (category: EntityCategory) => void;
  onRedetect: () => void;
  onNewDocument: () => void;
  onAnonymize: () => void;
  onCopyDocument: () => void;
  onSaveMap: () => void;
  onExport: (format: ExportFormat) => void;
  onLoadPrompts: () => void;
  onPromptSearch: (search: string) => void;
  onSelectPrompt: (id: string) => void;
  onCopyPrompt: (text: string) => void;
  onDeanonymizationInput: (input: string) => void;
  onDeanonymize: () => void;
  onLoadReplacementMap: () => void;
  onCopyDeanonymizedResult: () => void;
  onRegister: () => void;
  canRedetect: boolean;
}

export function DocumentWorkspace({
  document,
  entities,
  entityGroups,
  hiddenCategories,
  anonymization,
  prompts,
  deanonymization,
  processingStatus,
  processingError,
  tier,
  view,
  onViewChange,
  onToggleCategory,
  onRedetect,
  onNewDocument,
  onAnonymize,
  onCopyDocument,
  onSaveMap,
  onExport,
  onLoadPrompts,
  onPromptSearch,
  onSelectPrompt,
  onCopyPrompt,
  onDeanonymizationInput,
  onDeanonymize,
  onLoadReplacementMap,
  onCopyDeanonymizedResult,
  onRegister,
  canRedetect,
}: DocumentWorkspaceProps) {
  const [focusEntityId, setFocusEntityId] = useState<string | null>(null);
  const [activeEntityId, setActiveEntityId] = useState<string | null>(null);
  const [entityPopoverPosition, setEntityPopoverPosition] = useState({ x: 0, y: 0 });
  const [manualSelection, setManualSelection] = useState<DocumentTextSelection | null>(null);
  const [publicInstitutionsExpanded, setPublicInstitutionsExpanded] = useState(false);
  const {
    setEntityStatus,
    setEntityCategory,
    assignEntityToGroup,
    createGroupForEntity,
    addManualEntity,
    setEntityGroupStatus,
    mergeEntityGroups,
  } = useAppStore();
  const activeEntity = useMemo(
    () => entities.find((entity) => entity.id === activeEntityId) ?? null,
    [activeEntityId, entities],
  );
  const documentHiddenCategories = useMemo(() => {
    if (publicInstitutionsExpanded) {
      return hiddenCategories;
    }
    return [...new Set([...hiddenCategories, "PUBLIC_INSTITUTION" as EntityCategory])];
  }, [hiddenCategories, publicInstitutionsExpanded]);
  const markedCount = acceptedEntityCount(entities);

  const openEntityCorrection = (entityId: string, position: PopoverPosition) => {
    setManualSelection(null);
    setFocusEntityId(entityId);
    setActiveEntityId(entityId);
    setEntityPopoverPosition(position);
  };

  return (
    <div className="workspace">
      <div className="workspace__toolbar">
        <div className="workspace__file">
          <div className="workspace__filename">{document.filename}</div>
          <div className="workspace__filemeta">
            {view === "document" ? <>{texts.review.step} · </> : null}
            {document.format.toUpperCase()} ·{" "}
            {document.source === "ocr" ? texts.document.sourceOcr : texts.document.sourceParsed} ·{" "}
            {document.page_count} {texts.document.pages}
          </div>
        </div>
        {view === "document" && (
          <div className={`stat-badge ${markedCount === 0 ? "stat-badge--zero" : ""}`}>
            <strong>{markedCount}</strong>
            <span>{texts.review.toReplace}</span>
          </div>
        )}
        <div className="workspace__toolbar-spacer" />
        <button
          className="ghost-button ghost-button--compact"
          type="button"
          onClick={onNewDocument}
        >
          {texts.document.newDocument}
        </button>
        {view === "document" && (
          <button
            className="primary-button primary-button--compact"
            type="button"
            disabled={anonymization.status === "loading"}
            onClick={onAnonymize}
          >
            {anonymization.status === "loading"
              ? texts.generation.anonymizing
              : texts.generation.anonymize}
          </button>
        )}
      </div>

      {view === "document" && (
        <CategoryLegend
          entities={entities}
          hiddenCategories={hiddenCategories}
          onToggleCategory={onToggleCategory}
          onRedetect={onRedetect}
          redetectDisabled={!canRedetect || processingStatus === "loading"}
          redetectLoading={processingStatus === "loading"}
        />
      )}

      {view === "compare" ? (
        anonymization.replacementMap && anonymization.anonymizedText ? (
          <TierGate
            tier={tier}
            featureName={texts.compare.title}
            onRegister={onRegister}
            variant="card"
            description={texts.compare.gateDescription}
          >
            <ComparisonView
              originalText={document.text}
              anonymizedText={anonymization.anonymizedText}
              offsetMap={anonymization.offsetMap}
            />
          </TierGate>
        ) : (
          <div className="gate-card">
            <h3>{texts.nav.compare}</h3>
            <p>{texts.compare.needsResult}</p>
            <div className="toolbar">
              <button
                className="secondary-button"
                type="button"
                onClick={() => onViewChange("document")}
              >
                {texts.compare.backToDocument}
              </button>
            </div>
          </div>
        )
      ) : view === "result" && anonymization.replacementMap ? (
        <ResultView
          anonymization={anonymization}
          prompts={prompts}
          deanonymization={deanonymization}
          onCopyDocument={onCopyDocument}
          onSaveMap={onSaveMap}
          onExport={onExport}
          onLoadPrompts={onLoadPrompts}
          onPromptSearch={onPromptSearch}
          onSelectPrompt={onSelectPrompt}
          onCopyPrompt={onCopyPrompt}
          onDeanonymizationInput={onDeanonymizationInput}
          onDeanonymize={onDeanonymize}
          onLoadReplacementMap={onLoadReplacementMap}
          onCopyDeanonymizedResult={onCopyDeanonymizedResult}
        />
      ) : (
        <div className="workspace__body">
          <div className="workspace__document">
            <DocumentView
              document={document}
              entities={entities}
              hiddenCategories={documentHiddenCategories}
              focusEntityId={focusEntityId}
              onEntityClick={(entity, position) => {
                setManualSelection(null);
                setActiveEntityId(entity.id);
                setEntityPopoverPosition(position);
              }}
              onTextSelection={(selection) => {
                setActiveEntityId(null);
                setManualSelection(selection);
              }}
            />
          </div>
          <EntitySidebar
            entities={entities}
            groups={entityGroups}
            onFocusEntity={setFocusEntityId}
            onCorrectEntity={openEntityCorrection}
            onSetGroupStatus={setEntityGroupStatus}
            publicInstitutionsExpanded={publicInstitutionsExpanded}
            onPublicInstitutionsExpandedChange={setPublicInstitutionsExpanded}
          />
        </div>
      )}

      {activeEntity && (
        <EntityPopover
          entity={activeEntity}
          groups={entityGroups}
          position={entityPopoverPosition}
          onStatusChange={setEntityStatus}
          onCategoryChange={setEntityCategory}
          onAssignGroup={assignEntityToGroup}
          onCreateGroup={createGroupForEntity}
          onMergeGroups={mergeEntityGroups}
          onClose={() => setActiveEntityId(null)}
        />
      )}

      {manualSelection && (
        <ManualEntityPopover
          selection={manualSelection}
          groups={entityGroups}
          onAdd={(category, groupId) => {
            addManualEntity(manualSelection.range, category, groupId);
            setManualSelection(null);
            window.getSelection()?.removeAllRanges();
          }}
          onClose={() => setManualSelection(null)}
        />
      )}

      {anonymization.status === "error" && anonymization.error && view !== "result" && (
        <p className="workspace__alert" role="alert">
          {anonymization.error}
        </p>
      )}
      {processingStatus === "error" && processingError && (
        <p className="workspace__alert" role="alert">
          {processingError}
        </p>
      )}
    </div>
  );
}
