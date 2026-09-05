import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { texts } from "../i18n";
import type { OffsetMapEntry } from "../types";
import { ComparisonView } from "./ComparisonView";

afterEach(() => cleanup());

const OFFSET_MAP: OffsetMapEntry[] = [
  {
    original_start: 0,
    original_end: 12,
    anonymized_start: 0,
    anonymized_end: 9,
    token: "[OSOBA_1]",
    category: "PERSON",
  },
];

describe("ComparisonView", () => {
  it("renders both panes with their labels and text", () => {
    render(
      <ComparisonView
        originalText="Jan Kowalski zlozyl pozew."
        anonymizedText="[OSOBA_1] zlozyl pozew."
        offsetMap={OFFSET_MAP}
      />,
    );

    expect(screen.getByRole("region", { name: texts.compare.original })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: texts.compare.anonymized })).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski", { exact: false })).toBeInTheDocument();
  });

  it("highlights the replaced token in the anonymized pane with its category class", () => {
    render(
      <ComparisonView
        originalText="Jan Kowalski zlozyl pozew."
        anonymizedText="[OSOBA_1] zlozyl pozew."
        offsetMap={OFFSET_MAP}
      />,
    );

    const anonymizedPane = screen.getByRole("region", { name: texts.compare.anonymized });
    const highlight = anonymizedPane.querySelector("mark")!;
    expect(highlight.tagName).toBe("MARK");
    expect(highlight.className).toContain("cat--person");
    expect(highlight.title).toBe("[OSOBA_1]");
    expect(highlight.textContent).toBe("[OSOBA_1]");
  });

  it("renders plain text with no highlight when the offset map is empty", () => {
    render(<ComparisonView originalText="Zwykly tekst." anonymizedText="Zwykly tekst." offsetMap={[]} />);

    expect(screen.queryByRole("mark")).not.toBeInTheDocument();
    expect(screen.getAllByText("Zwykly tekst.").length).toBe(2);
  });

  it("syncs the scroll position of the other pane when one pane scrolls", () => {
    render(
      <ComparisonView
        originalText="Jan Kowalski zlozyl pozew."
        anonymizedText="[OSOBA_1] zlozyl pozew."
        offsetMap={OFFSET_MAP}
      />,
    );

    const originalBody = screen.getByRole("region", { name: texts.compare.original }).querySelector(
      ".comparison-pane__body",
    ) as HTMLDivElement;
    const anonymizedBody = screen
      .getByRole("region", { name: texts.compare.anonymized })
      .querySelector(".comparison-pane__body") as HTMLDivElement;

    Object.defineProperties(originalBody, {
      scrollTop: { value: 50, configurable: true },
      scrollHeight: { value: 100, configurable: true },
      clientHeight: { value: 50, configurable: true },
      scrollLeft: { value: 0, configurable: true },
      scrollWidth: { value: 100, configurable: true },
      clientWidth: { value: 100, configurable: true },
    });
    Object.defineProperties(anonymizedBody, {
      scrollTop: { value: 0, writable: true, configurable: true },
      scrollHeight: { value: 200, configurable: true },
      clientHeight: { value: 50, configurable: true },
      scrollLeft: { value: 0, writable: true, configurable: true },
      scrollWidth: { value: 100, configurable: true },
      clientWidth: { value: 100, configurable: true },
    });

    fireEvent.scroll(originalBody);

    // sourceMax = 100 - 50 = 50, ratio = 50/50 = 1, targetMax = 200 - 50 = 150
    expect(anonymizedBody.scrollTop).toBe(150);
  });
});
