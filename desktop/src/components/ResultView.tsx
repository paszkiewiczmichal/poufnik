import { useState } from "react";
import type { ReactNode } from "react";

import { texts } from "../i18n";
import type {
  AnonymizationState,
  DeanonymizationState,
  EntityCategory,
  ExportFormat,
  PromptState,
  ReplacementMap,
} from "../types";
import { DeanonymizePanel } from "./DeanonymizePanel";
import { PromptsPanel } from "./PromptsPanel";

type ResultTab = "document" | "text" | "map" | "restore";

interface ResultViewProps {
  anonymization: AnonymizationState;
  prompts: PromptState;
  deanonymization: DeanonymizationState;
  onCopyDocument: () => void;
  /** Saves the map; with a password it is encrypted (AES-256-GCM). */
  onSaveMap: (password: string | null) => void;
  onExport: (format: ExportFormat) => void;
  /** Source format the result can be saved in (xlsx, pptx, odt, ods, odp, png, jpg, heic). */
  ownFormat?: string | null;
  onExportOwnFormat?: () => void;
  /** Saves the anonymization report for the case file. */
  onSaveReport?: () => void;
  fileRestore?: ReactNode;
  /** Case controls (map of earlier documents of the same case), shown in the map tab. */
  caseControls?: ReactNode;
  /** "Przed" / "Po" drawn 1:1, for formats the window can draw (PDF, DOCX, pictures). */
  documentPreview?: ReactNode;
  exportNotice?: string | null;
  documentNotices?: string[];
  onLoadPrompts: () => void;
  onSelectPrompt: (id: string) => void;
  onCopyPrompt: (text: string) => void;
  onDeanonymizationInput: (input: string) => void;
  onDeanonymize: () => void;
  onLoadReplacementMap: () => void;
  onCopyDeanonymizedResult: () => void;
}

export function ResultView({
  anonymization,
  prompts,
  deanonymization,
  onCopyDocument,
  onSaveMap,
  onExport,
  ownFormat = null,
  onExportOwnFormat,
  onSaveReport,
  fileRestore,
  caseControls,
  documentPreview,
  exportNotice = null,
  documentNotices = [],
  onLoadPrompts,
  onSelectPrompt,
  onCopyPrompt,
  onDeanonymizationInput,
  onDeanonymize,
  onLoadReplacementMap,
  onCopyDeanonymizedResult,
}: ResultViewProps) {
  const [activeTab, setActiveTab] = useState<ResultTab>(documentPreview ? "document" : "text");
  const [mapVisible, setMapVisible] = useState(false);
  const [mapPassword, setMapPassword] = useState("");
  const [mapPasswordRepeat, setMapPasswordRepeat] = useState("");
  const passwordMismatch = mapPassword !== "" && mapPassword !== mapPasswordRepeat;
  const anonymizedText = anonymization.anonymizedText;
  const replacementMap = anonymization.replacementMap;
  const hasResult = Boolean(anonymizedText && replacementMap);
  const replacementCount = replacementMap?.entries.length ?? 0;
  const occurrenceCount = anonymization.offsetMap.length || replacementCount;
  const visibleNotices = documentNotices
    .map((code) => texts.generation.notices[code])
    .filter((notice): notice is string => Boolean(notice));

  const tabs: { id: ResultTab; label: string }[] = [
    ...(documentPreview ? [{ id: "document" as const, label: texts.generation.tabDocument }] : []),
    { id: "text", label: texts.generation.tabText },
    { id: "map", label: texts.generation.tabMap },
    { id: "restore", label: texts.generation.tabRestore },
  ];

  // What the engine changed besides the data (tracked changes accepted, comments removed...).
  const noticesBlock =
    visibleNotices.length > 0 ? (
      <div className="status-note document-notices">
        <span className="caps-label">{texts.generation.noticesTitle}</span>
        <ul>
          {visibleNotices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      </div>
    ) : null;

  // Saving is offered next to the 1:1 preview and next to the text.
  const exportButtons = (
    <>
      {ownFormat && onExportOwnFormat ? (
        <button
          className="ghost-button ghost-button--compact"
          type="button"
          disabled={!hasResult}
          onClick={onExportOwnFormat}
        >
          {texts.generation.exportOwnFormat(ownFormat)}
        </button>
      ) : null}
      <button
        className="ghost-button ghost-button--compact"
        type="button"
        disabled={!hasResult}
        onClick={() => onExport("docx")}
      >
        {texts.generation.exportDocx}
      </button>
      <button
        className="ghost-button ghost-button--compact"
        type="button"
        disabled={!hasResult}
        onClick={() => onExport("pdf")}
      >
        {texts.generation.exportPdf}
      </button>
      {onSaveReport ? (
        <button
          className="ghost-button ghost-button--compact"
          type="button"
          disabled={!hasResult}
          onClick={onSaveReport}
        >
          {texts.generation.report}
        </button>
      ) : null}
    </>
  );

  const selectTab = (tab: ResultTab) => {
    setActiveTab(tab);
    // Mapa chowa się przy każdym opuszczeniu zakładki.
    setMapVisible(false);
  };

  return (
    <section className="screen screen--wide result-view" aria-labelledby="result-title">
      <div className="screen__header">
        <div className="screen__header-text">
          <div className="screen-eyebrow">{texts.generation.step}</div>
          <h2 className="screen-title" id="result-title">
            {texts.generation.title}
          </h2>
        </div>
        {hasResult ? (
          <div className="stat-badge">
            <strong>{replacementCount}</strong>
            <span>{texts.generation.replacementBadge(replacementCount, occurrenceCount)}</span>
          </div>
        ) : null}
      </div>

      {anonymization.error && (
        <p className="error-note" role="alert">
          {anonymization.error}
        </p>
      )}

      <div className="result-tabs" role="tablist" aria-label={texts.generation.title}>
        {tabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            key={tab.id}
            role="tab"
            type="button"
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "document" && (
        <div className="card">
          <div className="card__header">
            <span className="caps-label">{texts.generation.documentHeader}</span>
            <div className="toolbar">{exportButtons}</div>
          </div>
          {exportNotice ? (
            <p className="status-note" role="status">
              {exportNotice}
            </p>
          ) : null}
          {noticesBlock}
          {documentPreview}
        </div>
      )}

      {activeTab === "text" && (
        <div className="result-grid">
          <div className="card">
            <div className="card__header">
              <span className="caps-label">{texts.generation.textHeader}</span>
              <div className="toolbar">
                <button
                  className="secondary-button secondary-button--compact"
                  type="button"
                  disabled={!hasResult}
                  onClick={onCopyDocument}
                >
                  {texts.generation.copyDocument}
                </button>
                {exportButtons}
              </div>
            </div>
            {exportNotice ? (
              <p className="status-note" role="status">
                {exportNotice}
              </p>
            ) : null}
            {noticesBlock}
            <pre className="result-text">{anonymizedText}</pre>
          </div>

          <PromptsPanel
            prompts={prompts}
            anonymizedText={anonymizedText}
            onLoad={onLoadPrompts}
            onSelect={onSelectPrompt}
            onCopyPrompt={onCopyPrompt}
          />
        </div>
      )}

      {activeTab === "map" && replacementMap && (
        <div className="card map-card">
          <div className="card__header card__header--stacked">
            <h3 className="card-title">{texts.generation.replacementMap}</h3>
            <p className="card__header-note">{texts.generation.mapNote}</p>
            <div className="toolbar settings-actions">
              <button
                className="secondary-button secondary-button--compact"
                type="button"
                onClick={() => setMapVisible((visible) => !visible)}
              >
                {mapVisible ? texts.generation.mapHide : texts.generation.mapShow}
              </button>
              <button
                className="ghost-button ghost-button--compact"
                type="button"
                disabled={passwordMismatch}
                onClick={() => onSaveMap(mapPassword || null)}
              >
                {mapPassword ? texts.generation.saveMapEncrypted : texts.generation.saveMap}
              </button>
            </div>
            <div className="map-password">
              <label className="field">
                <span>{texts.generation.mapPassword}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={mapPassword}
                  onChange={(event) => setMapPassword(event.target.value)}
                />
              </label>
              {mapPassword ? (
                <label className="field">
                  <span>{texts.generation.mapPasswordRepeat}</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={mapPasswordRepeat}
                    onChange={(event) => setMapPasswordRepeat(event.target.value)}
                  />
                </label>
              ) : null}
              <p className="muted">
                {passwordMismatch ? texts.generation.mapPasswordMismatch : texts.generation.mapPasswordNote}
              </p>
            </div>
          </div>
          {caseControls}
          {mapVisible ? (
            <ReplacementMapTable replacementMap={replacementMap} />
          ) : (
            <div className="map-card__blur">
              <div className="map-card__rows--blurred" aria-hidden="true">
                {replacementMap.entries.slice(0, 4).map((entry) => (
                  <div className="map-row" key={entry.token}>
                    <span className="map-row__token">{entry.token}</span>
                    <span className="map-row__value">{entry.canonical_text}</span>
                  </div>
                ))}
              </div>
              <div className="map-card__overlay">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setMapVisible(true)}
                >
                  {texts.generation.mapShow}
                </button>
                <span>{texts.generation.mapHiddenNote}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "restore" && (
        <DeanonymizePanel
          deanonymization={deanonymization}
          onInputChange={onDeanonymizationInput}
          onLoadMap={onLoadReplacementMap}
          onRestore={onDeanonymize}
          onCopyResult={onCopyDeanonymizedResult}
        />
      )}
      {activeTab === "restore" && fileRestore}
    </section>
  );
}

export function ReplacementMapTable({ replacementMap }: { replacementMap: ReplacementMap }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{texts.generation.token}</th>
            <th>{texts.corrections.category}</th>
            <th>{texts.generation.original}</th>
          </tr>
        </thead>
        <tbody>
          {replacementMap.entries.map((entry) => (
            <tr key={entry.token}>
              <td>{entry.token}</td>
              <td>{texts.categories[entry.category as EntityCategory] ?? entry.category}</td>
              <td>{entry.canonical_text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
