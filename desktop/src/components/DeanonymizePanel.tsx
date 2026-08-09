import { restoredSegmentsFromTokenizedText } from "../domain/deanonymization";
import { texts } from "../i18n";
import type { DeanonymizationState } from "../types";

interface DeanonymizePanelProps {
  deanonymization: DeanonymizationState;
  hasCurrentMap: boolean;
  onInputChange: (input: string) => void;
  onLoadMap: () => void;
  onRestore: () => void;
  onCopyResult: () => void;
}

export function DeanonymizePanel({
  deanonymization,
  hasCurrentMap,
  onInputChange,
  onLoadMap,
  onRestore,
  onCopyResult,
}: DeanonymizePanelProps) {
  const map = deanonymization.replacementMap;
  const segments =
    deanonymization.result && map
      ? restoredSegmentsFromTokenizedText(deanonymization.input, deanonymization.result, map)
      : [];

  return (
    <section className="card deanon-panel" aria-labelledby="deanon-panel-title">
      <h3 className="card-title" id="deanon-panel-title">
        {texts.deanonymization.title}
      </h3>
      <p className="deanon-panel__lead">{texts.deanonymization.lead}</p>
      <p className="muted">
        {hasCurrentMap ? texts.deanonymization.useCurrentMap : texts.errors.noReplacementMap}
      </p>

      <label className="field">
        <span>{texts.deanonymization.inputLabel}</span>
        <textarea
          value={deanonymization.input}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder={texts.deanonymization.inputPlaceholder}
          rows={8}
        />
      </label>

      <div className="toolbar">
        <button className="secondary-button" type="button" onClick={onLoadMap}>
          {texts.deanonymization.loadMap}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={!deanonymization.input.trim() || !map || deanonymization.status === "loading"}
          onClick={onRestore}
        >
          {deanonymization.status === "loading"
            ? texts.deanonymization.restoring
            : texts.deanonymization.restore}
        </button>
      </div>

      {deanonymization.status === "error" && deanonymization.error && (
        <p className="error-note" role="alert">
          {deanonymization.error}
        </p>
      )}

      {deanonymization.result && (
        <section className="deanon-result" aria-labelledby="deanon-result-title">
          <div className="deanon-result__header">
            <h3 id="deanon-result-title">{texts.deanonymization.result}</h3>
            <button className="link-button" type="button" onClick={onCopyResult}>
              {texts.deanonymization.copyResult}
            </button>
          </div>
          <p className="deanon-text">
            {segments.map((segment) =>
              segment.type === "restored" ? (
                <mark className="restored-fragment" key={`${segment.start}-${segment.end}`}>
                  {segment.text}
                </mark>
              ) : (
                <span key={`${segment.start}-${segment.end}`}>{segment.text}</span>
              ),
            )}
          </p>
          {deanonymization.warnings.length > 0 && (
            <div className="warning-list">
              <strong>{texts.deanonymization.warnings}</strong>
              {deanonymization.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
