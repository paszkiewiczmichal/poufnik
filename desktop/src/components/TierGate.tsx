import type { ReactNode } from "react";

import { texts } from "../i18n";
import type { ProductTier } from "../auth/types";

interface TierGateProps {
  tier: ProductTier;
  featureName: string;
  children: ReactNode;
  onRegister: () => void;
  /** "card" - pełnoekranowa karta bramki (ekrany narzędzi), "row" - kompaktowy wiersz. */
  variant?: "row" | "card";
  description?: string;
  /** Gdy podane, karta pokazuje drugi przycisk wracający do miejsca skąd użytkownik przyszedł. */
  onBack?: () => void;
  backLabel?: string;
}

export function TierGate({
  tier,
  featureName,
  children,
  onRegister,
  variant = "row",
  description,
  onBack,
  backLabel,
}: TierGateProps) {
  if (tier === "early_bird") {
    return children;
  }

  if (variant === "card") {
    return (
      <div className="gate-card" data-testid="tier-gate">
        <div className="gate-card__eyebrow">{texts.tiers.earlyBird}</div>
        <h3>{texts.tiers.earlyBirdFeature(featureName)}</h3>
        {description ? <p>{description}</p> : null}
        <p>{texts.tiers.earlyBirdHint}</p>
        <div className="toolbar">
          <button className="primary-button" type="button" onClick={onRegister}>
            {texts.auth.registerShort}
          </button>
          {onBack ? (
            <button className="secondary-button" type="button" onClick={onBack}>
              {backLabel ?? texts.tiers.backToResult}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="tier-gate" data-testid="tier-gate">
      <div className="tier-gate__body">
        <strong>{texts.tiers.earlyBirdFeature(featureName)}</strong>
        <p>{texts.tiers.earlyBirdHint}</p>
      </div>
      <button
        className="secondary-button secondary-button--compact"
        type="button"
        onClick={onRegister}
      >
        {texts.auth.registerShort}
      </button>
    </div>
  );
}
