import { describe, expect, it } from "vitest";

import { finishedMessage, progressHeadline, STARTING_PROGRESS } from "./shellProgress";

describe("finishedMessage", () => {
  it("shows the result of a single file as it is", () => {
    expect(finishedMessage(1, 0, "Zanonimizowano. Zapisano: a_poufnik.pdf", null)).toBe(
      "Zanonimizowano. Zapisano: a_poufnik.pdf",
    );
  });

  it("counts several files with the Polish plural", () => {
    expect(finishedMessage(3, 0, "x", null)).toBe("Zapisano 3 pliki.");
    expect(finishedMessage(5, 0, "x", null)).toBe("Zapisano 5 plików.");
  });

  it("names how many failed and the last error", () => {
    expect(finishedMessage(4, 1, "ok", "Nie udało się: b.pdf.")).toBe(
      "Przetworzono 3 z 4. Nie udało się: b.pdf.",
    );
  });
});

describe("progressHeadline", () => {
  it("says Poufnik is starting before the first file", () => {
    expect(progressHeadline(STARTING_PROGRESS)).toBe("Uruchamiam Poufnika...");
  });

  it("names the action and the current file number", () => {
    const working = { ...STARTING_PROGRESS, action: "metadata" as const, total: 5, done: 1 };
    expect(progressHeadline(working)).toBe("Usuwam metadane 2 z 5");
    expect(progressHeadline({ ...working, done: 5, finished: true })).toBe("Gotowe");
    expect(progressHeadline({ ...working, done: 5, failed: 1, finished: true })).toBe(
      "Wystąpił problem",
    );
    expect(progressHeadline({ ...working, total: 1, done: 0 })).toBe("Usuwam metadane");
  });
});
