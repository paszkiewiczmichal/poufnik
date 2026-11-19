import { useMemo, useState } from "react";
import type { ReactNode } from "react";

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
  anonymization: AnonymizationState;
  prompts: PromptState;
  deanonymization: DeanonymizationState;
  processingStatus: "idle" | "loading" | "error";
  processingError: string | null;
  tier: "basic" | "early_bird";
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  onRedetect: () => void;
  onNewDocument: () => void;
  onAnonymize: () => void;
  onCopyDocument: () => void;
  onSaveMap: (password: string | null) => void;
  onExport: (format: ExportFormat) => void;
  ownFormat?: string | null;
  onExportOwnFormat?: () => void;
  onSaveReport?: () => void;
  fileRestore?: ReactNode;
  documentPreview?: ReactNode;
  caseControls?: ReactNode;
  exportNotice?: string | null;
  documentNotices?: string[];
  unreadPages?: number[];
  onLoadPrompts: () => void;
  onSelectPrompt: (id: string) => void;
  onCopyPrompt: (text: string) => void;
  onDeanonymizationInput: (input: string) => void;
  onDeanonymize: () => void;
  onCopyDeanonymizedResult: () => void;
  onRegister: () => void;
  canRedetect: boolean;
  onManualEntityAdded?: (text: string, category: EntityCategory) => void;
  manualRuleNotice?: { text: string; warning: boolean } | null;
}

export function DocumentWorkspace({
  document,
  entities,
  entityGroups,
  anonymization,
  prompts,
  deanonymization,
  processingStatus,
  processingError,
  tier,
  view,
  onViewChange,
  onRedetect,
  onNewDocument,
  onAnonymize,
  onCopyDocument,
  onSaveMap,
  onExport,
  ownFormat,
  onExportOwnFormat,
  onSaveReport,
  fileRestore,
  documentPreview,
  caseControls,
  exportNotice,
  documentNotices,
  unreadPages,
  onLoadPrompts,
  onSelectPrompt,
  onCopyPrompt,
  onDeanonymizationInput,
  onDeanonymize,
  onCopyDeanonymizedResult,
  onRegister,
  canRedetect,
  onManualEntityAdded,
  manualRuleNotice = null,
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
    setCategoryStatus,
    mergeEntityGroups,
  } = useAppStore();
  const activeEntity = useMemo(
    () => entities.find((entity) => entity.id === activeEntityId) ?? null,
    [activeEntityId, entities],
  );
  const documentHiddenCategories = useMemo<EntityCategory[]>(
    () => (publicInstitutionsExpanded ? [] : ["PUBLIC_INSTITUTION"]),
    [publicInstitutionsExpanded],
  );
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
            {texts.document.pages(document.page_count)}
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
          onSetCategoryStatus={setCategoryStatus}
          onRedetect={onRedetect}
          redetectDisabled={!canRedetect || processingStatus === "loading"}
          redetectLoading={processingStatus === "loading"}
        />
      )}

      {view === "compare" ? (
        anonymization.replacementMap && anonymization.anonymizedText ? (
          <TierGate
            key="compare"
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
          ownFormat={ownFormat}
          onExportOwnFormat={onExportOwnFormat}
          onSaveReport={onSaveReport}
          fileRestore={fileRestore}
          documentPreview={documentPreview}
          caseControls={caseControls}
          exportNotice={exportNotice}
          documentNotices={documentNotices}
          unreadPages={unreadPages}
          onLoadPrompts={onLoadPrompts}
          onSelectPrompt={onSelectPrompt}
          onCopyPrompt={onCopyPrompt}
          onDeanonymizationInput={onDeanonymizationInput}
          onDeanonymize={onDeanonymize}
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
          canRemember={tier === "early_bird" && Boolean(onManualEntityAdded)}
          onAdd={(category, groupId, remember) => {
            addManualEntity(manualSelection.range, category, groupId);
            const group = groupId ? entityGroups.find((item) => item.id === groupId) : null;
            if (remember) {
              onManualEntityAdded?.(
                document.text.slice(manualSelection.range.start, manualSelection.range.end),
                group?.category ?? category,
              );
            }
            setManualSelection(null);
            window.getSelection()?.removeAllRanges();
          }}
          onClose={() => setManualSelection(null)}
        />
      )}

      {manualRuleNotice && view !== "result" && (
        <p
          className={manualRuleNotice.warning ? "workspace__alert" : "workspace__note"}
          role="status"
        >
          {manualRuleNotice.text}
        </p>
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
