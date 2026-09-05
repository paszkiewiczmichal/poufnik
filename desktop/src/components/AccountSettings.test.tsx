import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthState } from "../auth/types";
import { texts } from "../i18n";
import { AccountSettings } from "./AccountSettings";

afterEach(() => cleanup());

function renderSettings(props: Partial<Parameters<typeof AccountSettings>[0]> = {}) {
  const handlers = {
    onLogin: vi.fn().mockResolvedValue(undefined),
    onRegister: vi.fn(),
    onLogout: vi.fn(),
  };
  render(
    <AccountSettings
      authState={{ status: "basic", message: null }}
      error={null}
      loading={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("AccountSettings - basic (unauthenticated)", () => {
  it("shows the login form and basic-tier note", () => {
    renderSettings();

    expect(screen.getByText(texts.auth.settingsBasicNote)).toBeInTheDocument();
    expect(screen.getByLabelText(texts.account.email)).toBeInTheDocument();
    expect(screen.getByLabelText(texts.auth.password)).toBeInTheDocument();
  });

  it("shows the basic-state message when present", () => {
    renderSettings({ authState: { status: "basic", message: "Sesja wygasła." } });

    expect(screen.getByText("Sesja wygasła.")).toBeInTheDocument();
  });

  it("shows the error note when a login error is provided", () => {
    renderSettings({ error: "Nieprawidłowy e-mail lub hasło." });

    expect(screen.getByRole("alert")).toHaveTextContent("Nieprawidłowy e-mail lub hasło.");
  });

  it("submits the entered credentials via onLogin", async () => {
    const handlers = renderSettings();

    fireEvent.change(screen.getByLabelText(texts.account.email), {
      target: { value: "michal@example.com" },
    });
    fireEvent.change(screen.getByLabelText(texts.auth.password), {
      target: { value: "sekret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: texts.auth.login }));

    expect(handlers.onLogin).toHaveBeenCalledWith({
      email: "michal@example.com",
      password: "sekret123",
    });
  });

  it("shows the logging-in label and disables submit while loading", () => {
    renderSettings({ loading: true });

    expect(screen.getByRole("button", { name: texts.auth.loggingIn })).toBeDisabled();
  });

  it("calls onRegister from the create-account button", () => {
    const handlers = renderSettings();

    fireEvent.click(screen.getByRole("button", { name: texts.auth.createAccount }));

    expect(handlers.onRegister).toHaveBeenCalledTimes(1);
  });

  it("marks the Basic plan as active and Early Bird as a free account upsell", () => {
    renderSettings();

    const basicCard = screen.getByText("Basic").closest("article")!;
    expect(basicCard).toHaveClass("plan-card--active");
    expect(screen.getByText(texts.tiers.activeBadge)).toBeInTheDocument();
    expect(screen.getByText(texts.tiers.freeAccountBadge)).toBeInTheDocument();
  });

  it("marks Pro and Enterprise plans as future", () => {
    renderSettings();

    expect(screen.getAllByText(texts.tiers.later).length).toBe(2);
  });
});

describe("AccountSettings - authenticated (Early Bird)", () => {
  const authenticatedState: AuthState = {
    status: "authenticated",
    session: {
      accessToken: "tok",
      accountId: "acc-1",
      email: "michal@example.com",
      tier: "early_bird",
      issuedAt: 0,
      expiresAt: 0,
    },
    message: null,
  };

  it("shows the account email and Early Bird badge instead of the login form", () => {
    renderSettings({ authState: authenticatedState });

    expect(screen.getByText("michal@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText(texts.account.email)).not.toBeInTheDocument();
  });

  it("calls onLogout", () => {
    const handlers = renderSettings({ authState: authenticatedState });

    fireEvent.click(screen.getByRole("button", { name: texts.account.logout }));

    expect(handlers.onLogout).toHaveBeenCalledTimes(1);
  });

  it("marks the Early Bird plan as active instead of Basic", () => {
    renderSettings({ authState: authenticatedState });

    const plansGrid = within(screen.getByLabelText(texts.tiers.plansTitle));
    const earlyBirdCard = plansGrid.getByText("Early Bird").closest("article")!;
    expect(earlyBirdCard).toHaveClass("plan-card--active");
    const basicCard = plansGrid.getByText("Basic").closest("article")!;
    expect(basicCard).not.toHaveClass("plan-card--active");
  });
});
