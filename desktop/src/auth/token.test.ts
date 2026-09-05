import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

import { AuthTokenError, verifyAuthToken } from "./token";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

describe("account token verification", () => {
  it("accepts a valid Ed25519 account token", async () => {
    const token = createToken({ exp: Math.floor(Date.now() / 1000) + 3600 });

    await expect(verifyAuthToken(token, { publicKeyPem })).resolves.toMatchObject({
      accessToken: token,
      accountId: "11111111-1111-4111-8111-111111111111",
      email: "jan@example.com",
      tier: "early_bird",
    });
  });

  it("rejects an expired token", async () => {
    const token = createToken({ exp: Math.floor(Date.now() / 1000) - 1 });

    await expect(verifyAuthToken(token, { publicKeyPem })).rejects.toMatchObject({
      code: "expired",
    } satisfies Partial<AuthTokenError>);
  });

  it("rejects a token with a changed payload", async () => {
    const token = createToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
    const parts = token.split(".");
    const changedPayload = base64UrlJson({
      account_id: "11111111-1111-4111-8111-111111111111",
      email: "jan@example.com",
      tier: "basic",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    await expect(
      verifyAuthToken(`${parts[0]}.${changedPayload}.${parts[2]}`, { publicKeyPem }),
    ).rejects.toMatchObject({ code: "invalid_signature" } satisfies Partial<AuthTokenError>);
  });

  it("rejects when no public key is configured", async () => {
    const token = createToken();

    await expect(verifyAuthToken(token, { publicKeyPem: "  " })).rejects.toMatchObject({
      code: "missing_public_key",
    } satisfies Partial<AuthTokenError>);
  });

  it("rejects a token that is not made of three parts", async () => {
    await expect(verifyAuthToken("only.two", { publicKeyPem })).rejects.toMatchObject({
      code: "invalid_format",
    } satisfies Partial<AuthTokenError>);
  });

  it("rejects a header using an unsupported algorithm", async () => {
    const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
    const payload = base64UrlJson({
      account_id: "11111111-1111-4111-8111-111111111111",
      email: "jan@example.com",
      tier: "early_bird",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const signature = base64Url(sign(null, Buffer.from(`${header}.${payload}`), privateKey));

    await expect(
      verifyAuthToken(`${header}.${payload}.${signature}`, { publicKeyPem }),
    ).rejects.toMatchObject({ code: "invalid_payload" } satisfies Partial<AuthTokenError>);
  });

  it("rejects a header or payload segment that is not valid base64url JSON", async () => {
    await expect(verifyAuthToken("not-json.not-json.sig", { publicKeyPem })).rejects.toMatchObject({
      code: "invalid_payload",
    } satisfies Partial<AuthTokenError>);
  });

  it("rejects a malformed public key PEM", async () => {
    const token = createToken();

    await expect(
      verifyAuthToken(token, { publicKeyPem: "-----BEGIN PUBLIC KEY-----\nbm90LWEta2V5\n-----END PUBLIC KEY-----" }),
    ).rejects.toMatchObject({ code: "invalid_payload" } satisfies Partial<AuthTokenError>);
  });

  it("rejects a payload missing required account fields", async () => {
    const token = createToken({ account_id: undefined });

    await expect(verifyAuthToken(token, { publicKeyPem })).rejects.toMatchObject({
      code: "invalid_payload",
    } satisfies Partial<AuthTokenError>);
  });

  it("rejects a properly signed token for a non-Early-Bird tier", async () => {
    const token = createToken({ tier: "basic" });

    await expect(verifyAuthToken(token, { publicKeyPem })).rejects.toMatchObject({
      code: "unsupported_tier",
    } satisfies Partial<AuthTokenError>);
  });

  it("accepts an explicit now timestamp for expiry comparison", async () => {
    const token = createToken({ exp: 1_000 });

    await expect(verifyAuthToken(token, { publicKeyPem, now: 2_000_000 })).rejects.toMatchObject({
      code: "expired",
    } satisfies Partial<AuthTokenError>);
  });
});

function createToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "EdDSA", typ: "JWT" });
  const payload = base64UrlJson({
    account_id: "11111111-1111-4111-8111-111111111111",
    email: "jan@example.com",
    tier: "early_bird",
    iat: now,
    exp: now + 3600,
    ...overrides,
  });
  const signingInput = `${header}.${payload}`;
  const signature = base64Url(sign(null, Buffer.from(signingInput), privateKey));
  return `${signingInput}.${signature}`;
}

function base64UrlJson(payload: Record<string, unknown>): string {
  return base64Url(Buffer.from(JSON.stringify(payload)));
}

function base64Url(data: Buffer): string {
  return data.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

