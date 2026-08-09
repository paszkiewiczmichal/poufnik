import { describe, expect, it, vi } from "vitest";

import { AccountsClientError, exchangeDesktopLoginCode } from "./client";
import { loginViaBrowser } from "./browserLogin";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../tauri/external", () => ({ openExternalUrl: vi.fn() }));

const BASE_URL = "http://127.0.0.1:8000";

function makeDeps(overrides: Partial<Parameters<typeof loginViaBrowser>[0]> = {}) {
  let capturedState = "";
  const openUrl = vi.fn(async (url: string) => {
    const parsed = new URL(url);
    capturedState = parsed.searchParams.get("state") ?? "";
  });
  const invokeImpl = vi.fn(async (command: string) => {
    if (command === "start_browser_login_listener") {
      return 43210;
    }
    if (command === "await_browser_login") {
      return { code: "jednorazowy-kod", state: capturedState };
    }
    return undefined;
  });
  const exchange = vi.fn(async () => ({
    access_token: "token-ed25519",
    token_type: "bearer" as const,
    expires_in: 3600,
    tier: "early_bird",
  }));
  return {
    deps: {
      invokeImpl: invokeImpl as never,
      openUrl,
      exchange: exchange as never,
      baseUrl: BASE_URL,
      ...overrides,
    },
    invokeImpl,
    openUrl,
    exchange,
  };
}

describe("loginViaBrowser", () => {
  it("opens the accounts start URL with PKCE and exchanges the code for a token", async () => {
    const { deps, invokeImpl, openUrl, exchange } = makeDeps();

    const response = await loginViaBrowser(deps);

    expect(response.access_token).toBe("token-ed25519");
    const startUrl = new URL(openUrl.mock.calls[0][0]);
    expect(startUrl.origin + startUrl.pathname).toBe(`${BASE_URL}/v1/desktop-auth/start`);
    expect(startUrl.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43210/callback");
    expect(startUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(startUrl.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(invokeImpl).toHaveBeenCalledWith("await_browser_login", {
      port: 43210,
      successUrl: `${BASE_URL}/desktop/success`,
    });
    const [code, verifier] = exchange.mock.calls[0] as unknown as [string, string];
    expect(code).toBe("jednorazowy-kod");
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it("rejects a callback whose state does not match and abandons the listener", async () => {
    const { deps, invokeImpl, exchange } = makeDeps();
    invokeImpl.mockImplementation(async (command: string) => {
      if (command === "start_browser_login_listener") {
        return 43210;
      }
      if (command === "await_browser_login") {
        return { code: "jednorazowy-kod", state: "obcy-state" };
      }
      return undefined;
    });

    await expect(loginViaBrowser(deps)).rejects.toMatchObject({
      name: "AccountsClientError",
    });
    expect(exchange).not.toHaveBeenCalled();
    expect(invokeImpl).toHaveBeenCalledWith("cancel_browser_login", { port: 43210 });
  });

  it("propagates a timeout from the listener as a readable error", async () => {
    const { deps, invokeImpl } = makeDeps();
    invokeImpl.mockImplementation(async (command: string) => {
      if (command === "start_browser_login_listener") {
        return 43210;
      }
      if (command === "await_browser_login") {
        throw "Upłynął czas oczekiwania na logowanie w przeglądarce.";
      }
      return undefined;
    });

    await expect(loginViaBrowser(deps)).rejects.toMatchObject({
      message: "Upłynął czas oczekiwania na logowanie w przeglądarce.",
    });
  });
});

describe("exchangeDesktopLoginCode", () => {
  it("posts code and verifier and returns the token payload", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "token-ed25519",
          token_type: "bearer",
          expires_in: 3600,
          tier: "early_bird",
        }),
        { status: 200 },
      ),
    );

    const result = await exchangeDesktopLoginCode("kod", "verifier-x".repeat(5), {
      baseUrl: BASE_URL,
      fetchImpl: fetchImpl as never,
    });

    expect(result.tier).toBe("early_bird");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/desktop-auth/token`);
    expect(JSON.parse(String(init.body))).toEqual({
      code: "kod",
      code_verifier: "verifier-x".repeat(5),
    });
  });

  it("maps a 400 response to a server error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "Weryfikacja PKCE nie powiodła się." }), {
        status: 400,
      }),
    );

    await expect(
      exchangeDesktopLoginCode("kod", "verifier-x".repeat(5), {
        baseUrl: BASE_URL,
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toBeInstanceOf(AccountsClientError);
  });
});
