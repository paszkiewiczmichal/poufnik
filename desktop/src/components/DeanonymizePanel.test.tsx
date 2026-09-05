import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeanonymizePanel } from "./DeanonymizePanel";
import { texts } from "../i18n";
import type { DeanonymizationState, ReplacementMap } from "../types";

afterEach(() => {
  cleanup();
});

const baseDeanonymization: DeanonymizationState = {
  status: "idle",
  error: null,
  input: "",
  result: null,
  warnings: [],
  replacementMap: null,
  mapSource: null,
};

const REPLACEMENT_MAP: ReplacementMap = {
  document_fingerprint: "fp",
  entries: [
    { token: "[OSOBA_1]", category: "PERSON", canonical_text: "Jan Kowalski", variants: ["Jan Kowalski"] },
  ],
};

function renderPanel(
  deanonymization: DeanonymizationState,
  handlers: Partial<{
    onInputChange: ReturnType<typeof vi.fn>;
    onLoadMap: ReturnType<typeof vi.fn>;
    onRestore: ReturnType<typeof vi.fn>;
    onCopyResult: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const merged = {
    onInputChange: vi.fn(),
    onLoadMap: vi.fn(),
    onRestore: vi.fn(),
    onCopyResult: vi.fn(),
    ...handlers,
  };
  render(
    <DeanonymizePanel
      deanonymization={deanonymization}
      onInputChange={merged.onInputChange}
      onLoadMap={merged.onLoadMap}
      onRestore={merged.onRestore}
      onCopyResult={merged.onCopyResult}
    />,
  );
  return merged;
}

describe("DeanonymizePanel - map status label", () => {
  it("shows the no-map message when nothing is loaded", () => {
    renderPanel(baseDeanonymization);

    expect(screen.getByText(texts.errors.noReplacementMap)).toBeInTheDocument();
  });

  it("labels the map as coming from the current session", () => {
    renderPanel({ ...baseDeanonymization, replacementMap: {} as never, mapSource: "session" });

    expect(screen.getByText(texts.deanonymization.useCurrentMap)).toBeInTheDocument();
    expect(screen.queryByText(texts.deanonymization.useLoadedMap)).not.toBeInTheDocument();
  });

  it("labels the map as loaded from a file after Wczytaj mapę JSON", () => {
    renderPanel({ ...baseDeanonymization, replacementMap: {} as never, mapSource: "file" });

    expect(screen.getByText(texts.deanonymization.useLoadedMap)).toBeInTheDocument();
    expect(screen.queryByText(texts.deanonymization.useCurrentMap)).not.toBeInTheDocument();
  });
});

describe("DeanonymizePanel - input and actions", () => {
  it("calls onInputChange as the textarea is edited", () => {
    const handlers = renderPanel(baseDeanonymization);

    fireEvent.change(screen.getByLabelText(texts.deanonymization.inputLabel), {
      target: { value: "[OSOBA_1] zlozyl pozew." },
    });

    expect(handlers.onInputChange).toHaveBeenCalledWith("[OSOBA_1] zlozyl pozew.");
  });

  it("calls onLoadMap from the load-map button", () => {
    const handlers = renderPanel(baseDeanonymization);

    fireEvent.click(screen.getByRole("button", { name: texts.deanonymization.loadMap }));

    expect(handlers.onLoadMap).toHaveBeenCalledTimes(1);
  });

  it("disables restore when there is no input or no map", () => {
    renderPanel(baseDeanonymization);

    expect(screen.getByRole("button", { name: texts.deanonymization.restore })).toBeDisabled();
  });

  it("disables restore when there is input but no map", () => {
    renderPanel({ ...baseDeanonymization, input: "[OSOBA_1] zlozyl pozew." });

    expect(screen.getByRole("button", { name: texts.deanonymization.restore })).toBeDisabled();
  });

  it("enables restore once both input and a map are present, and calls onRestore", () => {
    const handlers = renderPanel({
      ...baseDeanonymization,
      input: "[OSOBA_1] zlozyl pozew.",
      replacementMap: REPLACEMENT_MAP,
      mapSource: "session",
    });

    const button = screen.getByRole("button", { name: texts.deanonymization.restore });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    expect(handlers.onRestore).toHaveBeenCalledTimes(1);
  });

  it("shows the restoring label and disables the button while loading", () => {
    renderPanel({
      ...baseDeanonymization,
      status: "loading",
      input: "[OSOBA_1] zlozyl pozew.",
      replacementMap: REPLACEMENT_MAP,
      mapSource: "session",
    });

    expect(screen.getByRole("button", { name: texts.deanonymization.restoring })).toBeDisabled();
  });

  it("shows the error alert when status is error", () => {
    renderPanel({ ...baseDeanonymization, status: "error", error: "Mapa jest uszkodzona" });

    expect(screen.getByRole("alert")).toHaveTextContent("Mapa jest uszkodzona");
  });
});

describe("DeanonymizePanel - restored result", () => {
  it("renders the restored text with tokens highlighted and calls onCopyResult", () => {
    const handlers = renderPanel({
      ...baseDeanonymization,
      input: "[OSOBA_1] zlozyl pozew.",
      result: "Jan Kowalski zlozyl pozew.",
      replacementMap: REPLACEMENT_MAP,
      mapSource: "session",
    });

    expect(screen.getByText(texts.deanonymization.result)).toBeInTheDocument();
    const mark = document.querySelector("mark.restored-fragment")!;
    expect(mark.textContent).toBe("Jan Kowalski");
    expect(document.querySelector(".deanon-text")?.textContent).toBe("Jan Kowalski zlozyl pozew.");

    fireEvent.click(screen.getByRole("button", { name: texts.deanonymization.copyResult }));

    expect(handlers.onCopyResult).toHaveBeenCalledTimes(1);
  });

  it("shows warnings when present", () => {
    renderPanel({
      ...baseDeanonymization,
      input: "[OSOBA_1] zlozyl pozew.",
      result: "Jan Kowalski zlozyl pozew.",
      replacementMap: REPLACEMENT_MAP,
      mapSource: "session",
      warnings: ["1 token bez odpowiednika w mapie."],
    });

    expect(screen.getByText(texts.deanonymization.warnings)).toBeInTheDocument();
    expect(screen.getByText("1 token bez odpowiednika w mapie.")).toBeInTheDocument();
  });

  it("does not render the result section when there is no result yet", () => {
    renderPanel(baseDeanonymization);

    expect(screen.queryByText(texts.deanonymization.result)).not.toBeInTheDocument();
  });
});
