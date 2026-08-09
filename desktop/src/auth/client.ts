import type { LoginCredentials } from "./types";

const DEFAULT_ACCOUNTS_BASE_URL = "http://127.0.0.1:8000";

export interface AccountTokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  tier: string;
}

export class AccountsClientError extends Error {
  constructor(
    readonly code:
      | "invalid_credentials"
      | "unverified_account"
      | "rate_limited"
      | "network"
      | "misconfigured"
      | "server",
    message: string,
  ) {
    super(message);
    this.name = "AccountsClientError";
  }
}

type FetchLike = typeof fetch;

export function getAccountsBaseUrl(): string {
  return normalizeBaseUrl(
    import.meta.env.VITE_POUFNIK_ACCOUNTS_BASE_URL || DEFAULT_ACCOUNTS_BASE_URL,
  );
}

export function getRegistrationUrl(baseUrl = getAccountsBaseUrl()): string {
  return `${baseUrl}/register`;
}

export function getPasswordResetUrl(baseUrl = getAccountsBaseUrl()): string {
  return `${baseUrl}/reset-password`;
}

export async function loginToAccounts(
  credentials: LoginCredentials,
  options: { baseUrl?: string; fetchImpl?: FetchLike } = {},
): Promise<AccountTokenResponse> {
  return postJson<AccountTokenResponse>(
    `${options.baseUrl ?? getAccountsBaseUrl()}/v1/login`,
    credentials,
    options.fetchImpl,
  );
}

export async function exchangeDesktopLoginCode(
  code: string,
  codeVerifier: string,
  options: { baseUrl?: string; fetchImpl?: FetchLike } = {},
): Promise<AccountTokenResponse> {
  return postJson<AccountTokenResponse>(
    `${options.baseUrl ?? getAccountsBaseUrl()}/v1/desktop-auth/token`,
    { code, code_verifier: codeVerifier },
    options.fetchImpl,
  );
}

export async function refreshAccountsToken(
  accessToken: string,
  options: { baseUrl?: string; fetchImpl?: FetchLike } = {},
): Promise<AccountTokenResponse> {
  return postJson<AccountTokenResponse>(
    `${options.baseUrl ?? getAccountsBaseUrl()}/v1/refresh`,
    {},
    options.fetchImpl,
    { Authorization: `Bearer ${accessToken}` },
  );
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new AccountsClientError(
      "misconfigured",
      "Brak adresu serwisu kont w konfiguracji aplikacji.",
    );
  }
  return trimmed;
}

async function postJson<T>(
  url: string,
  payload: unknown,
  fetchImpl: FetchLike = fetch,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new AccountsClientError(
      "network",
      `Nie można połączyć się z serwisem kont: ${String(error)}`,
    );
  }

  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return (await response.json()) as T;
}

async function errorFromResponse(response: Response): Promise<AccountsClientError> {
  const payload = await response.json().catch(() => null);
  const detail = typeof payload?.detail === "string" ? payload.detail : "";
  if (response.status === 401 && /verified/i.test(detail)) {
    return new AccountsClientError(
      "unverified_account",
      "Konto wymaga potwierdzenia adresu e-mail.",
    );
  }
  if (response.status === 401) {
    return new AccountsClientError(
      "invalid_credentials",
      "Nieprawidłowy e-mail lub hasło.",
    );
  }
  if (response.status === 429) {
    return new AccountsClientError(
      "rate_limited",
      "Zbyt wiele prób logowania. Spróbuj ponownie później.",
    );
  }
  return new AccountsClientError(
    "server",
    detail || "Serwis kont zwrócił błąd logowania.",
  );
}

