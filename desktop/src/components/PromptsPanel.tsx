import { useEffect } from "react";

import { renderPrompt } from "../domain/prompts";
import { texts } from "../i18n";
import type { PromptState } from "../types";

interface PromptsPanelProps {
  prompts: PromptState;
  anonymizedText: string | null;
  onLoad: () => void;
  onSelect: (id: string) => void;
  onCopyPrompt: (text: string) => void;
}

export function PromptsPanel({
  prompts,
  anonymizedText,
  onLoad,
  onSelect,
  onCopyPrompt,
}: PromptsPanelProps) {
  useEffect(() => {
    if (prompts.status === "idle") {
      onLoad();
    }
  }, [onLoad, prompts.status]);

  const selected =
    prompts.items.find((prompt) => prompt.id === prompts.selectedId) ?? prompts.items[0] ?? null;

  return (
    <section className="card prompt-panel" aria-labelledby="prompt-panel-title">
      <div className="card__header card__header--stacked">
        <h3 className="card-title" id="prompt-panel-title">
          {texts.prompts.title}
        </h3>
        <p className="card__header-note">{texts.prompts.lead}</p>
      </div>

      {prompts.status === "loading" && <p className="empty-note">{texts.prompts.loading}</p>}
      {prompts.status === "error" && prompts.error && (
        <p className="error-note" role="alert">
          {prompts.error}
        </p>
      )}

      <div className="prompt-list">
        {prompts.items.map((prompt) => (
          <button
            className={`prompt-item ${selected?.id === prompt.id ? "prompt-item--active" : ""}`}
            key={prompt.id}
            type="button"
            aria-pressed={selected?.id === prompt.id}
            onClick={() => onSelect(prompt.id)}
          >
            <span className="prompt-item__title">{prompt.title}</span>
            <span className="prompt-item__desc">{prompt.description}</span>
          </button>
        ))}
      </div>

      {selected && (
        <article className="prompt-preview">
          <p className="prompt-preview__text">{readablePrompt(selected.body)}</p>
          <div className="toolbar">
            <button
              className="primary-button primary-button--compact"
              type="button"
              disabled={!anonymizedText}
              title={!anonymizedText ? texts.prompts.needsAnonymizedDocument : undefined}
              onClick={() =>
                anonymizedText && onCopyPrompt(renderPrompt(selected.body, anonymizedText))
              }
            >
              {texts.prompts.copyWithDocument}
            </button>
            <button
              className="ghost-button ghost-button--compact"
              type="button"
              onClick={() => onCopyPrompt(selected.body)}
            >
              {texts.prompts.copyPrompt}
            </button>
          </div>
        </article>
      )}
    </section>
  );
}

// The preview shows the instruction itself; the document markers are noise to a reader.
function readablePrompt(body: string): string {
  return body
    .replace(/=== DOKUMENT[^=]*===\s*\{\{DOKUMENT\}\}\s*=== KONIEC DOKUMENTU ===/, "")
    .replace("{{DOKUMENT}}", "")
    .trim();
}
