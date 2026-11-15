import type { ReactNode } from "react";

/** One pane of the "Przed" / "Po" pair: label on top, the pages scroll inside (one scrollbar). */
export function PreviewFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="preview-pane" aria-label={label}>
      <div className="preview-pane__label caps-label">{label}</div>
      <div className="preview-pane__body">{children}</div>
    </section>
  );
}
