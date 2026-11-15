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

  it("writes headings without a trailing full stop", async () => {
    const { texts } = await import("./i18n");
    const headings = [
      texts.settings.title,
      texts.settings.advanced,
      texts.account.sectionTitle,
      texts.tiers.plansTitle,
      texts.updates.sectionTitle,
      texts.updates.settingsTitle,
      texts.updates.consentTitle,
      texts.updates.updateTitle,
      texts.history.heading,
      texts.history.disabledTitle,
      texts.customRules.heading,
      texts.start.title,
      texts.batch.heading,
      texts.processing.title,
      texts.errors.importTitle,
      texts.engine.failedTitle,
      texts.review.title,
      texts.entities.heading,
      texts.generation.title,
      texts.generation.replacementMap,
      texts.compare.title,
      texts.prompts.title,
      texts.deanonymization.title,
      texts.deanonymization.toolTitle,
    ];

    for (const heading of headings) {
      expect(heading.length).toBeGreaterThan(0);
      expect(heading).not.toMatch(/\.$/);
    }
  });

  it("uses an en dash, not a hyphen, as a dash and says plan, not layer, for the account", async () => {
    const { texts } = await import("./i18n");

    expect(texts.preview.after).toBe("Po – tak wygląda zapisany plik");
    expect(texts.account.sectionTitle).toBe("Konto i plan");
    const contents = fs.readFileSync(path.join(process.cwd(), "src", "i18n.ts"), "utf-8");
    expect(contents).not.toMatch(/"[^"\n]* - [^"\n]*"/);
  });

  it("does not promise better detection in a paid plan", async () => {
    const { texts } = await import("./i18n");
    const pro = texts.tiers.plans.find((plan) => plan.code === "pro");

    expect(pro?.description).not.toMatch(/dokładniejsz/i);
    expect(JSON.stringify(texts.tiers.plans)).not.toMatch(/dokładniejsz/i);
  });
});
