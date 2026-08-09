import { useEffect, useMemo } from "react";

import { renderPrompt } from "../domain/prompts";
import { texts } from "../i18n";
import type { PromptState } from "../types";

interface PromptsPanelProps {
  prompts: PromptState;
  anonymizedText: string | null;
  onLoad: () => void;
  onSearch: (search: string) => void;
  onSelect: (id: string) => void;
  onCopyPrompt: (text: string) => void;
}

export function PromptsPanel({
  prompts,
  anonymizedText,
  onLoad,
  onSearch,
  onSelect,
  onCopyPrompt,
}: PromptsPanelProps) {
  useEffect(() => {
    if (prompts.status === "idle") {
      onLoad();
    }
  }, [onLoad, prompts.status]);

  const filtered = useMemo(() => {
    const query = prompts.search.trim().toLowerCase();
    if (!query) {
      return prompts.items;
    }
    return prompts.items.filter((prompt) => {
      const haystack = `${prompt.title} ${prompt.tags.join(" ")}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [prompts.items, prompts.search]);

  const selected =
    filtered.find((prompt) => prompt.id === prompts.selectedId) ?? filtered[0] ?? null;

  return (
    <section className="card prompt-panel" aria-labelledby="prompt-panel-title">
      <div className="card__header card__header--stacked">
        <h3 className="card-title" id="prompt-panel-title">
          {texts.prompts.title}
        </h3>
        <p className="card__header-note">{texts.prompts.lead}</p>
      </div>
      <input
        className="search-input"
        type="search"
        value={prompts.search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={texts.prompts.search}
        aria-label={texts.prompts.search}
      />

      {prompts.status === "loading" && <p className="empty-note">{texts.prompts.loading}</p>}
      {prompts.status === "error" && prompts.error && (
        <p className="error-note" role="alert">
          {prompts.error}
        </p>
      )}

      <div className="prompt-list">
        {filtered.length === 0 && prompts.status === "ready" ? (
          <p className="empty-note">{texts.prompts.empty}</p>
        ) : (
          filtered.map((prompt) => (
            <button
              className={`prompt-item ${selected?.id === prompt.id ? "prompt-item--active" : ""}`}
              key={prompt.id}
              type="button"
              onClick={() => onSelect(prompt.id)}
            >
              <span className="prompt-item__body">
                <span className="prompt-item__title">{prompt.title}</span>
                <span className="prompt-item__desc">{prompt.description}</span>
              </span>
            </button>
          ))
        )}
      </div>

      {selected && (
        <article className="prompt-preview">
          <h3>{selected.title}</h3>
          <p>{selected.description}</p>
          <div className="tag-row">
            {selected.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <pre>{selected.body}</pre>
          <div className="toolbar">
            <button
              className="ghost-button ghost-button--compact"
              type="button"
              onClick={() => onCopyPrompt(selected.body)}
            >
              {texts.prompts.copyPrompt}
            </button>
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
          </div>
        </article>
      )}
    </section>
  );
}
