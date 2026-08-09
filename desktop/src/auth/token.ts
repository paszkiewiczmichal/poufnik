import type { AuthenticatedSession } from "./types";

export class AuthTokenError extends Error {
  constructor(
    readonly code:
      | "missing_public_key"
      | "invalid_format"
      | "invalid_payload"
      | "invalid_signature"
      | "expired"
      | "unsupported_tier",
    message: string,
  ) {
    super(message);
    this.name = "AuthTokenError";
  }
}

interface JwtHeader {
  alg?: string;
  typ?: string;
}

interface AccountTokenPayload {
  account_id?: unknown;
  email?: unknown;
  tier?: unknown;
  iat?: unknown;
  exp?: unknown;
}

export interface VerifyAuthTokenOptions {
  publicKeyPem: string;
  now?: number;
}

export async function verifyAuthToken(
  accessToken: string,
  options: VerifyAuthTokenOptions,
): Promise<AuthenticatedSession> {
  const publicKeyPem = options.publicKeyPem.trim();
  if (!publicKeyPem) {
    throw new AuthTokenError(
      "missing_public_key",
      "Brak publicznego klucza serwisu kont w konfiguracji aplikacji.",
    );
  }

  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    throw new AuthTokenError("invalid_format", "Nieprawidłowy format tokenu.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJson<JwtHeader>(encodedHeader);
  const payload = decodeJson<AccountTokenPayload>(encodedPayload);
  if (header.alg !== "EdDSA") {
    throw new AuthTokenError("invalid_payload", "Nieobsługiwany algorytm tokenu.");
  }

  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const publicKey = await importEd25519PublicKey(publicKeyPem);
  const signatureValid = await crypto.subtle.verify(
    "Ed25519",
    publicKey,
    bytesToArrayBuffer(base64UrlToBytes(encodedSignature)),
    signingInput,
  );
  if (!signatureValid) {
    throw new AuthTokenError("invalid_signature", "Nieprawidłowy podpis tokenu.");
  }

  const accountId = stringField(payload.account_id);
  const email = stringField(payload.email);
  const tier = stringField(payload.tier);
  const issuedAt = numberField(payload.iat);
  const expiresAt = numberField(payload.exp);
  if (!accountId || !email || !tier || issuedAt === null || expiresAt === null) {
    throw new AuthTokenError("invalid_payload", "Token nie zawiera wymaganych danych konta.");
  }
  if (tier !== "early_bird") {
    throw new AuthTokenError("unsupported_tier", "Token nie odblokowuje warstwy Early Bird.");
  }

  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (expiresAt < nowSeconds) {
    throw new AuthTokenError("expired", "Sesja wygasła.");
  }

  return {
    accessToken,
    accountId,
    email,
    tier,
    issuedAt,
    expiresAt,
  };
}

async function importEd25519PublicKey(publicKeyPem: string): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      "spki",
      pemToDer(publicKeyPem),
      "Ed25519",
      false,
      ["verify"],
    );
  } catch (error) {
    throw new AuthTokenError(
      "invalid_payload",
      `Nie można odczytać publicznego klucza serwisu kont: ${String(error)}`,
    );
  }
}

function decodeJson<T>(encoded: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))) as T;
  } catch (error) {
    throw new AuthTokenError(
      "invalid_payload",
      `Nie można odczytać tokenu sesji: ${String(error)}`,
    );
  }
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  return bytesToArrayBuffer(base64ToBytes(body));
}

function base64UrlToBytes(value: string): Uint8Array {
  return base64ToBytes(value.replace(/-/g, "+").replace(/_/g, "/"));
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
