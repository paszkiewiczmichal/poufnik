import { FormEvent, useState } from "react";

import type { AuthState, LoginCredentials } from "../auth/types";
import { texts } from "../i18n";

interface AccountSettingsProps {
  authState: AuthState;
  error: string | null;
  loading: boolean;
  onLogin: (credentials: LoginCredentials) => Promise<void>;
  onRegister: () => void;
  onLogout: () => void;
}

export function AccountSettings({
  authState,
  error,
  loading,
  onLogin,
  onRegister,
  onLogout,
}: AccountSettingsProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const authenticated = authState.status === "authenticated";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onLogin({ email, password });
  }

  return (
    <>
      <section className="settings-section">
        <h3>{texts.account.sectionTitle}</h3>
        {authState.status === "authenticated" ? (
          <>
            <div className="settings-account-row">
              <span className="settings-account-email">{authState.session.email}</span>
              <span className="tier-badge">{texts.tiers.earlyBird}</span>
              <div className="settings-actions">
                <button
                  className="secondary-button secondary-button--compact"
                  type="button"
                  onClick={onLogout}
                >
                  {texts.account.logout}
                </button>
              </div>
            </div>
            <p className="muted">{texts.account.note}</p>
            <p className="muted">{texts.common.connectivity}</p>
          </>
        ) : (
          <>
            {authState.status === "basic" && authState.message ? (
              <p className="status-note">{authState.message}</p>
            ) : null}
            <p className="muted">{texts.auth.settingsBasicNote}</p>
            <form className="settings-login-form" onSubmit={(event) => void submit(event)}>
              {error ? (
                <p className="error-note" role="alert">
                  {error}
                </p>
              ) : null}
              <label className="field">
                <span>{texts.account.email}</span>
                <input
                  autoComplete="email"
                  inputMode="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  required
                />
              </label>
              <label className="field">
                <span>{texts.auth.password}</span>
                <input
                  autoComplete="current-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  required
                />
              </label>
              <div className="settings-actions">
                <button className="primary-button" type="submit" disabled={loading}>
                  {loading ? texts.auth.loggingIn : texts.auth.login}
                </button>
                <button className="secondary-button" type="button" onClick={onRegister}>
                  {texts.auth.createAccount}
                </button>
              </div>
            </form>
            <p className="muted">{texts.auth.registerCta}</p>
          </>
        )}
      </section>

      <section className="settings-section">
        <h3>{texts.tiers.plansTitle}</h3>
        <div className="plans-grid" aria-label={texts.tiers.plansTitle}>
          {texts.tiers.plans.map((plan) => {
            const isActive =
              plan.code === "basic" ? !authenticated : plan.code === "early_bird" && authenticated;
            const isFuture = plan.code === "pro" || plan.code === "enterprise";
            return (
              <article
                className={`plan-card ${isActive ? "plan-card--active" : ""} ${
                  isFuture ? "plan-card--future" : ""
                }`}
                key={plan.code}
              >
                <strong>{plan.name}</strong>
                <span className="plan-card__status">
                  {isFuture
                    ? texts.tiers.later
                    : isActive
                      ? texts.tiers.activeBadge
                      : plan.code === "basic"
                        ? texts.tiers.freeBadge
                        : texts.tiers.freeAccountBadge}
                </span>
                <p>{plan.description}</p>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
