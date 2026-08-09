// Logowanie przez przeglądarkę systemową (authorization code + PKCE, public client).
// Aplikacja NIE trzyma sekretu klienta OAuth: otwiera przeglądarkę na serwisie kont, odbiera
// jednorazowy kod na loopbacku 127.0.0.1 (listener w Rust) i wymienia go na token
// Ed25519 przez auth/client.ts. Ochrona: state weryfikowany lokalnie + PKCE (S256).

import { invoke } from "@tauri-apps/api/core";

import { openExternalUrl } from "../tauri/external";
import {
  AccountsClientError,
  exchangeDesktopLoginCode,
  getAccountsBaseUrl,
  type AccountTokenResponse,
} from "./client";

interface BrowserLoginCallback {
  code: string;
  state: string;
}

export interface BrowserLoginDeps {
  invokeImpl?: typeof invoke;
  openUrl?: (url: string) => Promise<void>;
  exchange?: typeof exchangeDesktopLoginCode;
  baseUrl?: string;
}

export async function loginViaBrowser(
  deps: BrowserLoginDeps = {},
): Promise<AccountTokenResponse> {
  const invokeImpl = deps.invokeImpl ?? invoke;
  const openUrl = deps.openUrl ?? openExternalUrl;
  const exchange = deps.exchange ?? exchangeDesktopLoginCode;
  const baseUrl = deps.baseUrl ?? getAccountsBaseUrl();

  const state = randomUrlSafeToken(32);
  const codeVerifier = randomUrlSafeToken(48);
  const codeChallenge = await s256Challenge(codeVerifier);

  const port = await invokeImpl<number>("start_browser_login_listener");
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const startUrl =
    `${baseUrl}/v1/desktop-auth/start` +
    `?code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  try {
    await openUrl(startUrl);
    const callback = await invokeImpl<BrowserLoginCallback>("await_browser_login", {
      port,
      successUrl: `${baseUrl}/desktop/success`,
    });
    if (callback.state !== state) {
      throw new AccountsClientError(
        "server",
        "Odpowiedź logowania nie pasuje do rozpoczętej sesji. Spróbuj ponownie.",
      );
    }
    return await exchange(callback.code, codeVerifier, { baseUrl });
  } catch (error) {
    // Porzuć listener, jeśli wciąż czeka (np. użytkownik zamknął przeglądarkę).
    await invokeImpl("cancel_browser_login", { port }).catch(() => undefined);
    if (error instanceof AccountsClientError) {
      throw error;
    }
    throw new AccountsClientError(
      "network",
      typeof error === "string" ? error : "Logowanie w przeglądarce nie powiodło się.",
    );
  }
}

function randomUrlSafeToken(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer);
}

async function s256Challenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
