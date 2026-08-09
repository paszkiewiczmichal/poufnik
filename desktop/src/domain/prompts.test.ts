import { describe, expect, it } from "vitest";

import { renderPrompt } from "./prompts";

describe("renderPrompt", () => {
  it("injects anonymized document into every placeholder", () => {
    expect(renderPrompt("Analizuj:\n{{DOKUMENT}}\nKopia: {{DOKUMENT}}", "[OSOBA_1]")).toBe(
      "Analizuj:\n[OSOBA_1]\nKopia: [OSOBA_1]",
    );
  });
});
