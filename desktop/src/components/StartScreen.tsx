import { useState } from "react";
import type { DragEvent } from "react";

import { texts } from "../i18n";
import { ErrorIcon, FileIcon, LockIcon, UploadIcon } from "../ui/icons";
import type { ProcessingStep } from "../types";

interface StartScreenProps {
  engineStatus: "starting" | "ready" | "restarting" | "failed";
  processingStatus: "idle" | "loading" | "error";
  processingStep: ProcessingStep;
  processingError: string | null;
  forceOcr: boolean;
  fileName: string | null;
  onChooseFile: () => void;
  onDropFile: (file: File) => void;
}

export function StartScreen({
  engineStatus,
  processingStatus,
  processingStep,
  processingError,
  forceOcr,
  fileName,
  onChooseFile,
  onDropFile,
}: StartScreenProps) {
  const [dragActive, setDragActive] = useState(false);
  const disabled = engineStatus !== "ready" || processingStatus === "loading";

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files.item(0);
    if (file) {
      onDropFile(file);
    }
  };

  if (processingStatus === "loading") {
    return (
      <section className="processing-screen" aria-live="polite">
        {fileName ? (
          <div className="file-chip">
            <FileIcon />
            <div>
              <div className="file-chip__name">{fileName}</div>
            </div>
          </div>
        ) : null}
        <h2>{texts.processing.title}</h2>
        <ProcessingPhases step={processingStep} forceOcr={forceOcr} />
        <div className="progress-track" role="presentation">
          <div className="progress-track__fill" />
        </div>
        <p className="muted">{texts.processing.note}</p>
      </section>
    );
  }

  return (
    <section
      className="screen screen--import start-screen"
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      aria-labelledby="start-title"
    >
      <div className="screen-eyebrow">{texts.start.step}</div>
      <h1 className="screen-title" id="start-title">
        {texts.start.title}
      </h1>
      <p className="screen-lead">{texts.start.subtitle}</p>

      <div
        className={`drop-zone ${dragActive ? "drop-zone--active" : ""}`}
        onClick={() => {
          if (!disabled) {
            onChooseFile();
          }
        }}
      >
        <UploadIcon className="drop-zone__icon" />
        <div className="drop-zone__title">
          {dragActive ? texts.start.dropActive : texts.start.dropTitle}
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onChooseFile();
          }}
        >
          {texts.start.chooseFile}
        </button>
        <div className="drop-zone__formats">{texts.start.formats}</div>
      </div>

      <p className="muted">{texts.start.ocrNote}</p>

      <div className="offline-note">
        <LockIcon />
        <span>{texts.common.offlineFull}</span>
      </div>

      {engineStatus !== "ready" && (
        <p className="status-note">
          {engineStatus === "restarting" ? texts.engine.restarting : texts.engine.starting}
        </p>
      )}

      {processingStatus === "error" && processingError && (
        <div className="error-card" role="alert">
          <ErrorIcon />
          <div className="error-card__body">
            <h2 className="error-card__title">{texts.errors.importTitle}</h2>
            <p className="error-card__message">{processingError}</p>
            <div className="toolbar">
              <button
                className="secondary-button secondary-button--compact"
                type="button"
                disabled={disabled}
                onClick={onChooseFile}
              >
                {texts.errors.chooseAnother}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ProcessingPhases({ step, forceOcr }: { step: ProcessingStep; forceOcr: boolean }) {
  const order: ProcessingStep[] = ["parsing", "ocr", "detecting"];
  const activeIndex = order.indexOf(step);
  const phases = [
    { name: texts.processing.parsing, sub: texts.processing.parsingSub },
    {
      name: texts.processing.ocr,
      sub: forceOcr ? texts.processing.ocrSubForced : texts.processing.ocrSub,
    },
    { name: texts.processing.detecting, sub: texts.processing.detectingSub },
  ];

  return (
    <div className="phase-list">
      {phases.map((phase, index) => {
        const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
        return (
          <div className={`phase phase--${state}`} key={phase.name}>
            <span className="phase__mark" aria-hidden="true">
              {state === "done" ? "✓" : state === "active" ? "●" : "○"}
            </span>
            <div>
              <div className="phase__name">{phase.name}</div>
              <div className="phase__sub">{phase.sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
