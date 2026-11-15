import { useState } from "react";

import { texts } from "../i18n";

interface MapPasswordFormProps {
  error: string | null;
  onUnlock: (password: string) => void;
}

/** Password of an encrypted replacement map (mapCrypto.ts). */
export function MapPasswordForm({ error, onUnlock }: MapPasswordFormProps) {
  const [password, setPassword] = useState("");
  return (
    <form
      className="file-restore__unlock"
      onSubmit={(event) => {
        event.preventDefault();
        onUnlock(password);
        setPassword("");
      }}
    >
      <label className="field">
        <span>{texts.deanonymization.mapEncrypted}</span>
        <input
          type="password"
          autoComplete="off"
          aria-label={texts.deanonymization.mapPasswordField}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button className="secondary-button" type="submit" disabled={!password}>
        {texts.deanonymization.mapUnlock}
      </button>
      {error ? (
        <p className="error-note" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
