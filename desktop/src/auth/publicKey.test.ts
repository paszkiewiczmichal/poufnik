import { afterEach, describe, expect, it, vi } from "vitest";

import { getAccountsPublicKeyPem } from "./publicKey";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAccountsPublicKeyPem", () => {
  it("falls back to the built-in production key when none is configured at build time", () => {
    vi.stubEnv("VITE_POUFNIK_ACCOUNTS_PUBLIC_KEY_PEM", "");

    const pem = getAccountsPublicKeyPem();

    expect(pem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(pem).toContain("-----END PUBLIC KEY-----");
  });

  it("unescapes literal \\n sequences into real newlines", () => {
    vi.stubEnv(
      "VITE_POUFNIK_ACCOUNTS_PUBLIC_KEY_PEM",
      "-----BEGIN PUBLIC KEY-----\\nABC123\\n-----END PUBLIC KEY-----",
    );

    expect(getAccountsPublicKeyPem()).toBe(
      "-----BEGIN PUBLIC KEY-----\nABC123\n-----END PUBLIC KEY-----",
    );
  });
});
