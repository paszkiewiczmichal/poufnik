import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { texts } from "../i18n";
import { EngineError } from "./EngineError";

afterEach(() => cleanup());

describe("EngineError", () => {
  it("renders the given message", () => {
    render(<EngineError message="Silnik zakonczyl dzialanie nieoczekiwanie." />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Silnik zakonczyl dzialanie nieoczekiwanie.")).toBeInTheDocument();
    expect(screen.getByText(texts.engine.retryHint)).toBeInTheDocument();
  });

  it("falls back to the generic no-engine message when message is null", () => {
    render(<EngineError message={null} />);

    expect(screen.getByText(texts.errors.noEngine)).toBeInTheDocument();
  });
});
