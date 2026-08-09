import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { texts } from "./i18n";
import { useAppStore } from "./store/useAppStore";
import type { EngineEndpoint } from "./types";

const mocks = vi.hoisted(() => {
  const health = vi.fn();
  const apiClient = {
    analyze: vi.fn(),
    anonymize: vi.fn(),
    anonymizeApiEntities: vi.fn(),
    deanonymize: vi.fn(),
    exportDocument: vi.fn(),
    health,
    listPrompts: vi.fn(),
    processDocument: vi.fn(),
  };

  return {
    AuthTokenError: class AuthTokenError extends Error {
      constructor(readonly code: string, message: string) {
        super(message);
        this.name = "AuthTokenError";
      }
    },
    apiClient,
    health,
    checkForUpdate: vi.fn(),
    clearStoredAuthToken: vi.fn(),
    confirmSensitiveAction: vi.fn(),
    copyText: vi.fn(),
    fileFromPath: vi.fn(),
    getDocumentHistoryEnabled: vi.fn(),
    getEngineEndpoint: vi.fn(),
    getRegistrationUrl: vi.fn(),
    getStoredBasicChoice: vi.fn(),
    getUpdateConsent: vi.fn(),
    installUpdate: vi.fn(),
    isSupportedDocumentName: vi.fn(),
    listenToDroppedFiles: vi.fn(),
    listenToEngineStatus: vi.fn(),
    loginToAccounts: vi.fn(),
    loadCustomRegexRules: vi.fn(),
    openExternalUrl: vi.fn(),
    pickBrowserDocumentFile: vi.fn(),
    pickBrowserDocumentFiles: vi.fn(),
    pickDocumentFile: vi.fn(),
    pickDocumentFiles: vi.fn(),
    pickDocumentFolderFiles: vi.fn(),
    pickOutputDirectory: vi.fn(),
    pickReplacementMapFile: vi.fn(),
    readClipboardText: vi.fn(),
    readStoredAuthToken: vi.fn(),
    refreshAccountsToken: vi.fn(),
    saveBinaryFile: vi.fn(),
    exportBatchResultsToDirectory: vi.fn(),
    saveDocumentHistoryEntryIfEnabled: vi.fn(),
    saveCustomRegexRules: vi.fn(),
    saveJsonFile: vi.fn(),
    saveStoredAuthToken: vi.fn(),
    saveStoredBasicChoice: vi.fn(),
    saveUpdateConsent: vi.fn(),
    tauriDocumentHistoryBackend: {
      clear: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
    },
    verifyAuthToken: vi.fn(),
  };
});

vi.mock("./api/client", () => ({
  createAnonymizerApiClient: vi.fn(() => mocks.apiClient),
}));

vi.mock("./auth/client", () => ({
  loginToAccounts: mocks.loginToAccounts,
  refreshAccountsToken: mocks.refreshAccountsToken,
  getRegistrationUrl: mocks.getRegistrationUrl,
  AccountsClientError: class AccountsClientError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
      this.name = "AccountsClientError";
    }
  },
}));

vi.mock("./auth/publicKey", () => ({
  getAccountsPublicKeyPem: vi.fn(() => "test-public-key"),
}));

vi.mock("./auth/sessionStorage", () => ({
  clearStoredAuthToken: mocks.clearStoredAuthToken,
  getStoredBasicChoice: mocks.getStoredBasicChoice,
  readStoredAuthToken: mocks.readStoredAuthToken,
  saveStoredAuthToken: mocks.saveStoredAuthToken,
  saveStoredBasicChoice: mocks.saveStoredBasicChoice,
}));

vi.mock("./auth/token", () => ({
  AuthTokenError: mocks.AuthTokenError,
  verifyAuthToken: mocks.verifyAuthToken,
}));

vi.mock("./tauri/clipboard", () => ({
  copyText: mocks.copyText,
  readClipboardText: mocks.readClipboardText,
}));

vi.mock("./tauri/customRules", () => ({
  loadCustomRegexRules: mocks.loadCustomRegexRules,
  saveCustomRegexRules: mocks.saveCustomRegexRules,
}));

vi.mock("./tauri/engine", () => ({
  getEngineEndpoint: mocks.getEngineEndpoint,
  listenToEngineStatus: mocks.listenToEngineStatus,
}));

vi.mock("./tauri/files", () => ({
  confirmSensitiveAction: mocks.confirmSensitiveAction,
  exportBatchResultsToDirectory: mocks.exportBatchResultsToDirectory,
  fileFromPath: mocks.fileFromPath,
  isSupportedDocumentName: mocks.isSupportedDocumentName,
  listenToDroppedFiles: mocks.listenToDroppedFiles,
  pickBrowserDocumentFile: mocks.pickBrowserDocumentFile,
  pickBrowserDocumentFiles: mocks.pickBrowserDocumentFiles,
  pickDocumentFile: mocks.pickDocumentFile,
  pickDocumentFiles: mocks.pickDocumentFiles,
  pickDocumentFolderFiles: mocks.pickDocumentFolderFiles,
  pickOutputDirectory: mocks.pickOutputDirectory,
  pickReplacementMapFile: mocks.pickReplacementMapFile,
  saveBinaryFile: mocks.saveBinaryFile,
  saveJsonFile: mocks.saveJsonFile,
}));

vi.mock("./tauri/history", () => ({
  getDocumentHistoryEnabled: mocks.getDocumentHistoryEnabled,
  saveDocumentHistoryEntryIfEnabled: mocks.saveDocumentHistoryEntryIfEnabled,
  tauriDocumentHistoryBackend: mocks.tauriDocumentHistoryBackend,
}));

vi.mock("./tauri/updater", () => ({
  checkForUpdate: mocks.checkForUpdate,
  getUpdateConsent: mocks.getUpdateConsent,
  installUpdate: mocks.installUpdate,
  saveUpdateConsent: mocks.saveUpdateConsent,
}));

vi.mock("./tauri/external", () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

const endpoint: EngineEndpoint = {
  baseUrl: "http://127.0.0.1:8710",
  port: 8710,
  token: "test-token",
};

const earlyBirdSession = {
  accessToken: "valid-token",
  accountId: "11111111-1111-4111-8111-111111111111",
  email: "jan@example.com",
  tier: "early_bird",
  issuedAt: 1,
  expiresAt: 99_999_999_999,
};

describe("App engine health", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
    mocks.clearStoredAuthToken.mockResolvedValue(undefined);
    mocks.getDocumentHistoryEnabled.mockReturnValue(false);
    mocks.getEngineEndpoint.mockResolvedValue(endpoint);
    mocks.getRegistrationUrl.mockReturnValue("http://127.0.0.1:8000/register");
    mocks.getStoredBasicChoice.mockReturnValue(true);
    mocks.getUpdateConsent.mockReturnValue(false);
    mocks.health.mockResolvedValue({
      models_loaded: false,
      status: "degraded",
      version: "0.1.0",
    });
    mocks.apiClient.analyze.mockResolvedValue({ entities: [] });
    mocks.apiClient.anonymize.mockResolvedValue({
      anonymized_text: "Anonimizowany tekst",
      replacement_map: { document_fingerprint: "test", entries: [] },
      offset_map: [],
    });
    mocks.apiClient.anonymizeApiEntities.mockResolvedValue({
      anonymized_text: "Anonimizowany tekst",
      replacement_map: { document_fingerprint: "test", entries: [] },
      offset_map: [],
    });
    mocks.apiClient.processDocument.mockResolvedValue({
      document: {
        filename: "test.txt",
        format: "txt",
        source: "parsed",
        page_count: 1,
        text: "Jan Kowalski",
      },
      entities: [],
      anonymized_text: "Jan Kowalski",
      replacement_map: { document_fingerprint: "test", entries: [] },
      offset_map: [],
    });
    mocks.isSupportedDocumentName.mockReturnValue(true);
    mocks.listenToDroppedFiles.mockResolvedValue(() => undefined);
    mocks.listenToEngineStatus.mockResolvedValue(() => undefined);
    mocks.loginToAccounts.mockResolvedValue({
      access_token: "valid-token",
      expires_in: 2_592_000,
      tier: "early_bird",
      token_type: "bearer",
    });
    mocks.loadCustomRegexRules.mockReturnValue([]);
    mocks.openExternalUrl.mockResolvedValue(undefined);
    mocks.readStoredAuthToken.mockResolvedValue(null);
    mocks.refreshAccountsToken.mockRejectedValue(new Error("offline"));
    mocks.saveStoredAuthToken.mockResolvedValue(undefined);
    mocks.verifyAuthToken.mockResolvedValue(earlyBirdSession);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a warning banner when engine health is degraded", async () => {
    render(<App />);

    await waitFor(() => expect(mocks.health).toHaveBeenCalled());

    expect(await screen.findByRole("status")).toHaveTextContent(
      texts.engine.degradedBanner,
    );
  });

  it("shows the optional login screen on a fresh install", async () => {
    mocks.getStoredBasicChoice.mockReturnValue(false);

    render(<App />);

    expect(
      await screen.findByRole("button", { name: texts.auth.continueBasic }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: texts.auth.startTitle })).toBeInTheDocument();
  });

  it("continues to Basic and remembers the choice", async () => {
    mocks.getStoredBasicChoice.mockReturnValue(false);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: texts.auth.continueBasic }));

    await waitFor(() => expect(mocks.saveStoredBasicChoice).toHaveBeenCalledWith(true));
    expect(await screen.findByRole("heading", { name: texts.start.title })).toBeInTheDocument();
  });

  it("does not contact the account service when stored Basic mode is active", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: texts.start.title })).toBeInTheDocument();
    expect(mocks.loginToAccounts).not.toHaveBeenCalled();
    expect(mocks.refreshAccountsToken).not.toHaveBeenCalled();
  });

  it("logs in and shows the Early Bird tier in settings", async () => {
    mocks.getStoredBasicChoice.mockReturnValue(false);

    render(<App />);

    fireEvent.change(await screen.findByLabelText(texts.account.email), {
      target: { value: "jan@example.com" },
    });
    fireEvent.change(screen.getByLabelText(texts.auth.password), {
      target: { value: "bardzodlugiehaslo" },
    });
    fireEvent.click(screen.getByRole("button", { name: texts.auth.login }));

    await waitFor(() => expect(mocks.saveStoredAuthToken).toHaveBeenCalledWith("valid-token"));
    fireEvent.click(await screen.findByRole("button", { name: texts.updates.settings }));

    expect((await screen.findAllByText(texts.tiers.earlyBird)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("jan@example.com").length).toBeGreaterThan(0);
  });

  it("degrades an expired stored token to Basic", async () => {
    mocks.getStoredBasicChoice.mockReturnValue(false);
    mocks.readStoredAuthToken.mockResolvedValue("expired-token");
    mocks.verifyAuthToken.mockRejectedValue(
      new mocks.AuthTokenError("expired", "Sesja wygasła."),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: texts.start.title })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: texts.updates.settings }));
    expect(await screen.findByText(texts.auth.expired)).toBeInTheDocument();
  });

  it("shows the batch feature as an Early Bird prompt in Basic", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: texts.start.title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: texts.nav.batch }));

    expect(screen.getByTestId("tier-gate")).toHaveTextContent(texts.batch.title);
    expect(screen.queryByRole("heading", { name: texts.batch.title })).not.toBeInTheDocument();
  });

  it("does not apply saved custom rules while in Basic", async () => {
    mocks.loadCustomRegexRules.mockReturnValue([
      {
        enabled: true,
        id: "rule-1",
        label: "CUSTOM",
        name: "Sygnatura",
        pattern: "ABC-[0-9]+",
      },
    ]);
    mocks.pickDocumentFile.mockResolvedValue(new File(["ABC-123"], "test.txt"));

    render(<App />);

    const chooseFile = await screen.findByRole("button", { name: texts.start.chooseFile });
    await waitFor(() => expect(chooseFile).not.toBeDisabled());
    fireEvent.click(chooseFile);

    await waitFor(() => expect(mocks.apiClient.processDocument).toHaveBeenCalled());
    expect(mocks.apiClient.analyze).not.toHaveBeenCalled();
  });

  it("rejects a document over the 50 MB limit before contacting the engine", async () => {
    const oversizedFile = new File(["x"], "duzy-skan.pdf");
    Object.defineProperty(oversizedFile, "size", { value: 50 * 1024 * 1024 + 1 });
    mocks.pickDocumentFile.mockResolvedValue(oversizedFile);

    render(<App />);

    const chooseFile = await screen.findByRole("button", { name: texts.start.chooseFile });
    await waitFor(() => expect(chooseFile).not.toBeDisabled());
    fireEvent.click(chooseFile);

    expect(await screen.findByText(texts.errors.payloadTooLarge)).toBeInTheDocument();
    expect(mocks.apiClient.processDocument).not.toHaveBeenCalled();
  });

  it("shows the batch panel for Early Bird sessions", async () => {
    mocks.readStoredAuthToken.mockResolvedValue("valid-token");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: texts.nav.batch }));

    expect(await screen.findByRole("heading", { name: texts.batch.title })).toBeInTheDocument();
    expect(screen.getByText(texts.batch.empty)).toBeInTheDocument();
  });
});
