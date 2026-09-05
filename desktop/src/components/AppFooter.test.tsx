import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { texts } from "../i18n";
import { AppFooter } from "./AppFooter";

afterEach(() => cleanup());

describe("AppFooter", () => {
  it("shows the offline notice", () => {
    render(<AppFooter onOpenKancelaria={vi.fn()} onOpenLawtern={vi.fn()} />);

    expect(screen.getByText(texts.footer.offline)).toBeInTheDocument();
  });

  it("calls onOpenLawtern and prevents default navigation when the Lawtern link is clicked", () => {
    const onOpenLawtern = vi.fn();
    render(<AppFooter onOpenKancelaria={vi.fn()} onOpenLawtern={onOpenLawtern} />);

    const link = screen.getByRole("link", { name: texts.footer.lawternLabel });
    const event = fireEvent.click(link);

    expect(onOpenLawtern).toHaveBeenCalledTimes(1);
    expect(event).toBe(false);
  });

  it("calls onOpenKancelaria and prevents default navigation when the Kancelaria link is clicked", () => {
    const onOpenKancelaria = vi.fn();
    render(<AppFooter onOpenKancelaria={onOpenKancelaria} onOpenLawtern={vi.fn()} />);

    const link = screen.getByRole("link", { name: texts.footer.kancelariaLabel });
    fireEvent.click(link);

    expect(onOpenKancelaria).toHaveBeenCalledTimes(1);
  });
});
