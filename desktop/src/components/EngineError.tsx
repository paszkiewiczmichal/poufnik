import { texts } from "../i18n";

interface EngineErrorProps {
  message: string | null;
}

export function EngineError({ message }: EngineErrorProps) {
  return (
    <section className="engine-error" role="alert" aria-labelledby="engine-error-title">
      <h1 id="engine-error-title">{texts.engine.failedTitle}</h1>
      <p>{message ?? texts.errors.noEngine}</p>
      <span>{texts.engine.retryHint}</span>
    </section>
  );
}
