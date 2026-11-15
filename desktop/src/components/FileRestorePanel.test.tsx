import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import { FileRestorePanel, IDLE_FILE_RESTORE } from "./FileRestorePanel";

afterEach(cleanup);

function renderPanel(props: Partial<Parameters<typeof FileRestorePanel>[0]> = {}) {
  const handlers = {
    onChooseFile: vi.fn(),
    onChooseMap: vi.fn(),
    onCancelChoice: vi.fn(),
    onLoadMap: vi.fn(),
    onUnlockMap: vi.fn(),
  };
  render(<FileRestorePanel state={IDLE_FILE_RESTORE} disabled={false} {...handlers} {...props} />);
  return handlers;
}

describe("FileRestorePanel", () => {
  it("lets the user load a map by hand from the start screen", () => {
    const handlers = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: texts.deanonymization.loadMapShort }));

    expect(handlers.onLoadMap).toHaveBeenCalledTimes(1);
  });

  it("asks for the password of an encrypted map and shows a wrong one", () => {
    const handlers = renderPanel({ lockedMap: { error: "Nieprawidłowe hasło." } });

    expect(screen.getByRole("alert")).toHaveTextContent("Nieprawidłowe hasło.");
    const unlock = screen.getByRole("button", { name: texts.deanonymization.mapUnlock });
    expect(unlock).toBeDisabled();

    fireEvent.change(screen.getByLabelText(texts.deanonymization.mapPasswordField), {
      target: { value: "Tajne-2026" },
    });
    fireEvent.click(unlock);

    expect(handlers.onUnlockMap).toHaveBeenCalledWith("Tajne-2026");
  });

  it("does not show the password field without an encrypted map", () => {
    renderPanel();

    expect(screen.queryByLabelText(texts.deanonymization.mapPasswordField)).toBeNull();
  });
});
