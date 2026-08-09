import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("i18n copy rules", () => {
  it("does not contain forbidden account/offline phrases", () => {
    const contents = fs.readFileSync(path.join(process.cwd(), "src", "i18n.ts"), "utf-8");
    const forbiddenPatterns = [
      ["bez", "konta"],
      ["zero", "rejestracji"],
      ["aplikacja", "nigdy", "nie", "łączy", "się", "z", "internetem"],
    ].map((parts) => new RegExp(parts.join("\\s+"), "i"));

    for (const pattern of forbiddenPatterns) {
      expect(contents).not.toMatch(pattern);
    }
  });

  it("uses user-facing wording for detected data", () => {
    const contents = fs.readFileSync(path.join(process.cwd(), "src", "i18n.ts"), "utf-8");
    const technicalEntityWord = ["en", "cj", "a"].join("");
    const nerWord = ["N", "E", "R"].join("");

    expect(contents).not.toMatch(new RegExp(`\\b${technicalEntityWord}[a-ząćęłńóśźż]*\\b`, "i"));
    expect(contents).not.toMatch(new RegExp(`\\b${nerWord}\\b`));
  });

  it("keeps Pro and Enterprise as future plan copy only", async () => {
    const { texts } = await import("./i18n");

    expect(texts.auth.registerCta).not.toMatch(/\b(Pro|Enterprise)\b/);
    for (const plan of texts.tiers.plans) {
      if (plan.code === "pro" || plan.code === "enterprise") {
        expect(plan.status).toBe(texts.tiers.later);
      }
    }
  });
});
