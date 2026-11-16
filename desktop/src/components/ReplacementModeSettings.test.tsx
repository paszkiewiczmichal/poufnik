import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import { ReplacementModeSettings } from "./ReplacementModeSettings";

afterEach(cleanup);

describe("ReplacementModeSettings", () => {
  it("switches between tokens and fictional data", () => {
    const onChange = vi.fn();
    render(<ReplacementModeSettings mode="tokens" onChange={onChange} />);

    expect(screen.getByRole("radio", { name: new RegExp(texts.replacementMode.tokens.slice(0, 10)) })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Dane fikcyjne/ }));

    expect(onChange).toHaveBeenCalledWith("pseudonyms");
  });

  it("switches the document profile to a judgment for publication", () => {
    const onProfileChange = vi.fn();
    render(
      <ReplacementModeSettings
        mode="tokens"
        onChange={vi.fn()}
        profile="standard"
        onProfileChange={onProfileChange}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /Orzeczenie do publikacji/ }));

    expect(onProfileChange).toHaveBeenCalledWith("judgment");
  });

  it("offers painting over faces, on by default, and reports the change", () => {
    const onMaskFacesChange = vi.fn();
    render(
      <ReplacementModeSettings
        mode="tokens"
        onChange={vi.fn()}
        onMaskFacesChange={onMaskFacesChange}
      />,
    );

    const box = screen.getByRole("checkbox", { name: /Zamaluj twarze na zdjęciach i skanach/ });
    expect(box).toBeChecked();
    fireEvent.click(box);

    expect(onMaskFacesChange).toHaveBeenCalledWith(false);
  });
});
