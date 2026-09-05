import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AccountsClientError,
  exchangeDesktopLoginCode,
  getAccountsBaseUrl,
  getPasswordResetUrl,
  getRegistrationUrl,
  loginToAccounts,
  refreshAccountsToken,
} from "./client";

afterEach(() => {
  vi.unstubAllEnvs();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getAccountsBaseUrl", () => {
  it("defaults to the production accounts URL", () => {
    vi.stubEnv("VITE_POUFNIK_ACCOUNTS_BASE_URL", "");

    expect(getAccountsBaseUrl()).toBe("https://account.lawtern.com");
  });

  it("strips trailing slashes and surrounding whitespace from a configured URL", () => {
    vi.stubEnv("VITE_POUFNIK_ACCOUNTS_BASE_URL", "  https://staging.lawtern.com/// ");

    expect(getAccountsBaseUrl()).toBe("https://staging.lawtern.com");
  });

  it("throws a misconfigured error when the configured URL is blank", () => {
    vi.stubEnv("VITE_POUFNIK_ACCOUNTS_BASE_URL", "   ");

    expect(() => getAccountsBaseUrl()).toThrow(AccountsClientError);
    try {
      getAccountsBaseUrl();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AccountsClientError);
      expect((error as AccountsClientError).code).toBe("misconfigured");
    }
  });
});

describe("getRegistrationUrl / getPasswordResetUrl", () => {
  it("append the expected paths to the base URL", () => {
    expect(getRegistrationUrl("https://accounts.example.com")).toBe(
      "https://accounts.example.com/register",
    );
    expect(getPasswordResetUrl("https://accounts.example.com")).toBe(
      "https://accounts.example.com/reset-password",
    );
  });
});

describe("loginToAccounts", () => {
  it("posts credentials to /v1/login and returns the parsed token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: "tok", token_type: "bearer", expires_in: 3600, tier: "pro" }),
    );

    const result = await loginToAccounts(
      { email: "michal@example.com", password: "sekret" },
      { baseUrl: "https://accounts.example.com", fetchImpl },
    );

    expect(result.access_token).toBe("tok");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://accounts.example.com/v1/login",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ email: "michal@example.com", password: "sekret" }),
      }),
    );
  });

  it("throws invalid_credentials on a 401 without a verification hint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { detail: "Bad credentials" }));

    await expect(
      loginToAccounts(
        { email: "a@b.pl", password: "x" },
        { baseUrl: "https://accounts.example.com", fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("throws unverified_account on a 401 mentioning verification", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { detail: "Account not verified yet" }));

    await expect(
      loginToAccounts(
        { email: "a@b.pl", password: "x" },
        { baseUrl: "https://accounts.example.com", fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "unverified_account" });
  });

  it("throws rate_limited on a 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, {}));

    await expect(
      loginToAccounts(
        { email: "a@b.pl", password: "x" },
        { baseUrl: "https://accounts.example.com", fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("throws a server error carrying the response detail for other statuses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { detail: "Awaria bazy danych" }));

    await expect(
      loginToAccounts(
        { email: "a@b.pl", password: "x" },
        { baseUrl: "https://accounts.example.com", fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "server", message: "Awaria bazy danych" });
  });

  it("falls back to a generic server message when the error body has no detail", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("not json", { status: 500 }),
    );

    await expect(
      loginToAccounts(
        { email: "a@b.pl", password: "x" },
        { baseUrl: "https://accounts.example.com", fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "server", message: "Serwis kont zwrócił błąd logowania." });
  });

  it("throws a network error when the fetch call itself fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      loginToAccounts(
        { email: "a@b.pl", password: "x" },
        { baseUrl: "https://accounts.example.com", fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "network" });
  });
});

describe("exchangeDesktopLoginCode", () => {
  it("posts the code and verifier to /v1/desktop-auth/token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: "tok2", token_type: "bearer", expires_in: 60, tier: "basic" }),
    );

    const result = await exchangeDesktopLoginCode("abc", "verifier123", {
      baseUrl: "https://accounts.example.com",
      fetchImpl,
    });

    expect(result.access_token).toBe("tok2");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://accounts.example.com/v1/desktop-auth/token",
      expect.objectContaining({
        body: JSON.stringify({ code: "abc", code_verifier: "verifier123" }),
      }),
    );
  });
});

describe("refreshAccountsToken", () => {
  it("posts with a bearer Authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: "tok3", token_type: "bearer", expires_in: 60, tier: "pro" }),
    );

    await refreshAccountsToken("old-token", { baseUrl: "https://accounts.example.com", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://accounts.example.com/v1/refresh",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer old-token" }),
      }),
    );
  });
});
