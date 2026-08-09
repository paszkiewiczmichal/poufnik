import { FormEvent, useState } from "react";

import { images } from "../assets/images";
import { texts } from "../i18n";
import { LockIcon } from "../ui/icons";
import type { LoginCredentials } from "../auth/types";
import { AppFooter } from "./AppFooter";

interface AuthStartScreenProps {
  error: string | null;
  loading: boolean;
  browserLoginLoading: boolean;
  onLogin: (credentials: LoginCredentials) => Promise<void>;
  onLoginBrowser: () => void;
  onRegister: () => void;
  onContinueBasic: () => void;
  onOpenKancelaria: () => void;
  onOpenLawtern: () => void;
}

export function AuthStartScreen({
  error,
  loading,
  browserLoginLoading,
  onLogin,
  onLoginBrowser,
  onRegister,
  onContinueBasic,
  onOpenKancelaria,
  onOpenLawtern,
}: AuthStartScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onLogin({ email, password });
  }

  return (
    <main className="auth-shell">
      <div className="auth-split">
        <section className="auth-content" aria-labelledby="auth-title">
          <img className="auth-content__logo" src={images.logo} alt={texts.appTitle} />
          <h1 id="auth-title">{texts.auth.startTitle}</h1>
          <p className="auth-content__lead">{texts.auth.startLead}</p>

          <div className="auth-content__cta">
            <button className="primary-button" type="button" onClick={onContinueBasic}>
              {texts.auth.continueBasic}
            </button>
            <span className="auth-content__cta-note">{texts.auth.continueBasicNote}</span>
          </div>

          <div className="auth-divider" role="presentation">
            <span>{texts.auth.orEarlyBird}</span>
          </div>

          <form className="auth-card" onSubmit={(event) => void submit(event)}>
            <p className="auth-card__note">{texts.auth.registerCta}</p>
            {error ? (
              <p className="error-note" role="alert">
                {error}
              </p>
            ) : null}
            <div className="auth-card__fields">
              <label className="field">
                <span>{texts.account.email}</span>
                <input
                  autoComplete="email"
                  inputMode="email"
                  type="email"
                  placeholder={texts.auth.emailPlaceholder}
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
            </div>
            <div className="auth-card__actions">
              <button className="primary-button" type="submit" disabled={loading}>
                {loading ? texts.auth.loggingIn : texts.auth.login}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={loading || browserLoginLoading}
                onClick={onLoginBrowser}
              >
                {browserLoginLoading ? texts.auth.browserWaiting : texts.auth.loginBrowser}
              </button>
              <span className="auth-card__register">
                {texts.auth.noAccountPrompt}{" "}
                <button className="link-button" type="button" onClick={onRegister}>
                  {texts.auth.registerLink}
                </button>
              </span>
            </div>
          </form>

          <p className="auth-content__footnote">{texts.account.note}</p>
        </section>

        <aside className="auth-aside">
          <img className="auth-aside__hero" src={images.hero} alt="" />
          <div className="auth-aside__note">
            <LockIcon />
            <p>{texts.common.offlineFull}</p>
          </div>
          <div className="auth-aside__note">
            <LockIcon />
            <p>{texts.common.compliance}</p>
          </div>
        </aside>
      </div>
      <AppFooter onOpenKancelaria={onOpenKancelaria} onOpenLawtern={onOpenLawtern} />
    </main>
  );
}
