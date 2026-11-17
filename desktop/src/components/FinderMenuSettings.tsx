import { texts } from "../i18n";
import { openExternalUrl } from "../tauri/external";

/** WebView na Macu (WKWebView) przedstawia się jako „Macintosh”. */
export const IS_MACOS = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);

// Ustawienia systemowe macOS, lista rozszerzeń (tam włącza się rozszerzenie Findera).
// Adres musi przejść przez wyrażenie plugins.shell.open w tauri.macos.conf.json.
export const MAC_EXTENSIONS_SETTINGS_URL = "x-apple.systempreferences:com.apple.ExtensionsPreferences";

/** Tylko Poufnik z DMG na Macu: rozszerzenie Findera trzeba raz włączyć w systemie. */
export function FinderMenuSettings() {
  return (
    <section className="settings-section">
      <h3>{texts.finderMenu.heading}</h3>
      <p className="muted">{texts.finderMenu.lead}</p>
      <div className="settings-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            void openExternalUrl(MAC_EXTENSIONS_SETTINGS_URL).catch(() => undefined);
          }}
        >
          {texts.finderMenu.open}
        </button>
      </div>
    </section>
  );
}
