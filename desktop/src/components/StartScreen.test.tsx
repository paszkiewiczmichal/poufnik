import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import { StartScreen } from "./StartScreen";

afterEach(() => cleanup());

function renderScreen(props: Partial<Parameters<typeof StartScreen>[0]> = {}) {
  const handlers = { onChooseFile: vi.fn(), onDropFile: vi.fn() };
  render(
    <StartScreen
      engineStatus="ready"
      processingStatus="idle"
      processingStep="parsing"
      processingError={null}
      forceOcr={false}
      fileName={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

function dropFileEvent(file: File) {
  return { dataTransfer: { files: { item: () => file } } };
}

describe("StartScreen - import screen", () => {
  it("shows the drop zone and calls onChooseFile when clicked", () => {
    const handlers = renderScreen();

    fireEvent.click(screen.getByText(texts.start.dropTitle));

    expect(handlers.onChooseFile).toHaveBeenCalledTimes(1);
  });

  it("calls onChooseFile from the explicit choose-file button without double-firing the drop zone handler", () => {
    const handlers = renderScreen();

    fireEvent.click(screen.getByRole("button", { name: texts.start.chooseFile }));

    expect(handlers.onChooseFile).toHaveBeenCalledTimes(1);
  });

  it("shows drag-active copy while dragging over and reverts on drag leave", () => {
    renderScreen();
    const dropZone = screen.getByText(texts.start.dropTitle).closest(".drop-zone")!;

    fireEvent.dragOver(dropZone);
    expect(screen.getByText(texts.start.dropActive)).toBeInTheDocument();

    fireEvent.dragLeave(dropZone);
    expect(screen.getByText(texts.start.dropTitle)).toBeInTheDocument();
  });

  it("calls onDropFile with the dropped file", () => {
    const handlers = renderScreen();
    const dropZone = screen.getByText(texts.start.dropTitle).closest(".drop-zone")!;
    const file = new File(["x"], "pismo.pdf", { type: "application/pdf" });

    fireEvent.drop(dropZone, dropFileEvent(file));

    expect(handlers.onDropFile).toHaveBeenCalledWith(file);
  });

  it("does not call onDropFile when the drop has no file", () => {
    const handlers = renderScreen();
    const dropZone = screen.getByText(texts.start.dropTitle).closest(".drop-zone")!;

    fireEvent.drop(dropZone, dropFileEvent(null as never));

    expect(handlers.onDropFile).not.toHaveBeenCalled();
  });

  it("disables file selection while the engine is not ready", () => {
    renderScreen({ engineStatus: "starting" });

    expect(screen.getByRole("button", { name: texts.start.chooseFile })).toBeDisabled();
    expect(screen.getByText(texts.engine.starting)).toBeInTheDocument();
  });

  it("shows the restarting note when the engine is restarting", () => {
    renderScreen({ engineStatus: "restarting" });

    expect(screen.getByText(texts.engine.restarting)).toBeInTheDocument();
  });

  it("shows an error card with a retry action when processing failed", () => {
    const handlers = renderScreen({ processingStatus: "error", processingError: "Plik uszkodzony" });

    expect(screen.getByRole("alert")).toHaveTextContent("Plik uszkodzony");

    fireEvent.click(screen.getByRole("button", { name: texts.errors.chooseAnother }));

    expect(handlers.onChooseFile).toHaveBeenCalledTimes(1);
  });
});

describe("StartScreen - processing screen", () => {
  it("shows the processing phases and the current file name", () => {
    renderScreen({ processingStatus: "loading", processingStep: "ocr", fileName: "skan.pdf" });

    expect(screen.getByText("skan.pdf")).toBeInTheDocument();
    expect(screen.getByText(texts.processing.title)).toBeInTheDocument();
    expect(screen.getByText(texts.processing.ocrSub)).toBeInTheDocument();
  });

  it("shows the forced-OCR sub-label when forceOcr is enabled", () => {
    renderScreen({ processingStatus: "loading", processingStep: "ocr", forceOcr: true });

    expect(screen.getByText(texts.processing.ocrSubForced)).toBeInTheDocument();
  });

  it("does not show a file chip when there is no file name yet", () => {
    renderScreen({ processingStatus: "loading", fileName: null });

    expect(screen.queryByText(texts.processing.title)).toBeInTheDocument();
  });
});
