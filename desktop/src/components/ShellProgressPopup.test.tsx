import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { STARTING_PROGRESS } from "../domain/shellProgress";
import { ShellProgressView } from "./ShellProgressPopup";

describe("ShellProgressView", () => {
  it("shows the action and file while working, with a moving bar for one file", () => {
    const { container } = render(
      <ShellProgressView
        progress={{ ...STARTING_PROGRESS, action: "anonymize", file: "umowa.pdf", total: 1 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Anonimizuję")).toBeTruthy();
    expect(screen.getByText("umowa.pdf")).toBeTruthy();
    expect(container.querySelector(".shell-progress__fill--moving")).not.toBeNull();
  });

  it("fills the bar by finished files and shows the result at the end", () => {
    const { container, rerender } = render(
      <ShellProgressView
        progress={{ ...STARTING_PROGRESS, action: "ocr", file: "b.pdf", total: 4, done: 1 }}
        onClose={vi.fn()}
      />,
    );
    const fill = container.querySelector<HTMLElement>(".shell-progress__fill");
    expect(fill?.style.width).toBe("25%");
    rerender(
      <ShellProgressView
        progress={{
          ...STARTING_PROGRESS,
          action: "ocr",
          total: 4,
          done: 4,
          failed: 1,
          finished: true,
          message: "Przetworzono 3 z 4.",
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Przetworzono 3 z 4.")).toBeTruthy();
    expect(container.querySelector(".shell-progress--failed")).not.toBeNull();
  });
});
