import { useState } from "react";

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

type ResultTab = "text" | "map" | "restore";

interface ResultViewProps {
  anonymization: AnonymizationState;
  prompts: PromptState;
  deanonymization: DeanonymizationState;
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
}

export function ResultView({
  anonymization,
  prompts,
  deanonymization,
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
}: ResultViewProps) {
  const [activeTab, setActiveTab] = useState<ResultTab>("text");
  const [mapVisible, setMapVisible] = useState(false);
  const anonymizedText = anonymization.anonymizedText;
  const replacementMap = anonymization.replacementMap;
  const hasResult = Boolean(anonymizedText && replacementMap);
  const replacementCount = replacementMap?.entries.length ?? 0;
  const occurrenceCount = anonymization.offsetMap.length || replacementCount;

  const tabs: { id: ResultTab; label: string }[] = [
    { id: "text", label: texts.generation.tabText },
    { id: "map", label: texts.generation.tabMap },
    { id: "restore", label: texts.generation.tabRestore },
  ];

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
              </div>
            </div>
            <pre className="result-text">{anonymizedText}</pre>
          </div>

          <PromptsPanel
            prompts={prompts}
            anonymizedText={anonymizedText}
            onLoad={onLoadPrompts}
            onSearch={onPromptSearch}
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
                onClick={onSaveMap}
              >
                {texts.generation.saveMap}
              </button>
            </div>
          </div>
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
          hasCurrentMap={Boolean(deanonymization.replacementMap)}
          onInputChange={onDeanonymizationInput}
          onLoadMap={onLoadReplacementMap}
          onRestore={onDeanonymize}
          onCopyResult={onCopyDeanonymizedResult}
        />
      )}
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
