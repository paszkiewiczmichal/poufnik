import { afterEach, describe, expect, it, vi } from "vitest";

import { getAccountsPublicKeyPem } from "./publicKey";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAccountsPublicKeyPem", () => {
  it("returns an empty string when no key is configured", () => {
    vi.stubEnv("VITE_POUFNIK_ACCOUNTS_PUBLIC_KEY_PEM", "");

    expect(getAccountsPublicKeyPem()).toBe("");
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
