import { useCallback, useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";

import "./App.css";
import { createAnonymizerApiClient } from "./api/client";
import { toUserMessage } from "./api/errors";
import {
  AccountsClientError,
  loginToAccounts,
  refreshAccountsToken,
  getRegistrationUrl,
} from "./auth/client";
import { getAccountsPublicKeyPem } from "./auth/publicKey";
import {
  clearStoredAuthToken,
  getStoredBasicChoice,
  readStoredAuthToken,
  saveStoredAuthToken,
  saveStoredBasicChoice,
} from "./auth/sessionStorage";
import { loginViaBrowser } from "./auth/browserLogin";
import { AuthTokenError, verifyAuthToken } from "./auth/token";
import type { AuthenticatedSession, AuthState, LoginCredentials, ProductTier } from "./auth/types";
import { images } from "./assets/images";
import { AccountSettings } from "./components/AccountSettings";
import { AppFooter } from "./components/AppFooter";
import { AuthStartScreen } from "./components/AuthStartScreen";
import { BatchPanel } from "./components/BatchPanel";
import { CustomRulesPanel } from "./components/CustomRulesPanel";
import { DocumentWorkspace, type WorkspaceView } from "./components/DocumentWorkspace";
import { EngineError } from "./components/EngineError";
import { StartScreen } from "./components/StartScreen";
import { TierGate } from "./components/TierGate";
import {
  createBatchQueueItems,
  processBatchQueue,
  type BatchItemPatch,
} from "./domain/batchProcessing";
import { enabledCustomRulePayloads } from "./domain/customRules";
import { blocksForExport } from "./domain/documentSegments";
import { texts } from "./i18n";
import { useAppStore } from "./store/useAppStore";
import { getAppVersion } from "./tauri/app";
import { copyText, readClipboardText } from "./tauri/clipboard";
import { loadCustomRegexRules, saveCustomRegexRules } from "./tauri/customRules";
import { getEngineEndpoint, listenToEngineStatus } from "./tauri/engine";
import {
  getDocumentHistoryEnabled,
  saveDocumentHistoryEntryIfEnabled,
  setDocumentHistoryEnabled,
  tauriDocumentHistoryBackend,
  type DocumentHistorySummary,
} from "./tauri/history";
import {
  checkForUpdate,
  getUpdateConsent,
  installUpdate,
  saveUpdateConsent,
  type UpdateConsent,
} from "./tauri/updater";
import {
  confirmSensitiveAction,
  exportBatchResultsToDirectory,
  fileFromPath,
  isSupportedDocumentName,
  listenToDroppedFiles,
  pickBrowserDocumentFiles,
  pickReplacementMapFile,
  pickBrowserDocumentFile,
  pickDocumentFile,
  pickDocumentFiles,
  pickDocumentFolderFiles,
  pickOutputDirectory,
  saveBinaryFile,
  saveJsonFile,
} from "./tauri/files";
import { openExternalUrl } from "./tauri/external";
import { FileIcon } from "./ui/icons";
import type {
  CustomRegexRule,
  CustomRegexRulePayload,
  BatchQueueItem,
  BatchProcessSuccess,
  DocumentProcessResponse,
  EngineEndpoint,
  EntityCategory,
  ExportFormat,
  ReplacementMap,
} from "./types";

type AppScreen = "flow" | "history" | "batch" | "settings";

declare global {
  interface Window {
    __ANONYMIZER_E2E__?: {
      importDocument: (path: string) => Promise<void>;
      addManualEntityByText: (text: string, category?: string) => void;
      enableEarlyBird: () => void;
      useBasicTier: () => void;
      openLatestHistoryEntry: () => Promise<void>;
      setHistoryEnabled: (enabled: boolean) => void;
      rejectFirstEntityContaining: (text: string) => void;
      readClipboard: () => Promise<string>;
      openScreen: (screen: AppScreen) => void;
      setWorkspaceView: (view: WorkspaceView) => void;
      storeApi: typeof useAppStore;
      snapshot: () => {
        anonymizedText: string | null;
        batchDone: number;
        batchErrors: number;
        batchTotal: number;
        deanonymizedText: string | null;
        entityCount: number;
        engineError: string | null;
        engineHealthStatus: string | null;
        engineStatus: string;
        processingError: string | null;
        processingStatus: string;
        productTier: ProductTier;
      };
    };
  }
}

// Limit uzgodniony z copy i audytem bezpieczeństwa (W4/S6).
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function App() {
  const {
    document,
    entities,
    entityGroups,
    anonymization,
    prompts,
    deanonymization,
    uiState,
    setEngineStarting,
    setEngineRestarting,
    setEngineReady,
    setEngineHealthStatus,
    setEngineFailed,
    setForceOcr,
    setProcessing,
    setProcessingError,
    setProcessedDocument,
    restoreDocumentSession,
    toggleCategory,
    setAnonymizationLoading,
    setAnonymizationError,
    setAnonymizationResult,
    setPromptsLoading,
    setPromptsError,
    setPrompts,
    setPromptSearch,
    setSelectedPrompt,
    setDeanonymizationInput,
    setDeanonymizationLoading,
    setDeanonymizationError,
    setDeanonymizationResult,
    setDeanonymizationMap,
    resetDocument,
  } = useAppStore();
  const [appVersion, setAppVersion] = useState("");
  const [screen, setScreen] = useState<AppScreen>("flow");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("document");
  const [updateConsent, setUpdateConsentState] = useState<UpdateConsent>(null);
  const [showUpdateConsent, setShowUpdateConsent] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [downloadedUpdateBytes, setDownloadedUpdateBytes] = useState(0);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [historyEnabled, setHistoryEnabledState] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<DocumentHistorySummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [customRules, setCustomRulesState] = useState<CustomRegexRule[]>([]);
  const [batchItems, setBatchItems] = useState<BatchQueueItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [browserLoginLoading, setBrowserLoginLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const productTier: ProductTier =
    authState.status === "authenticated" ? "early_bird" : "basic";

  const loadHistoryEntries = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistoryEntries(await tauriDocumentHistoryBackend.list());
    } catch (error) {
      setHistoryError(toUserMessage(error) || texts.history.loadFailed);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const applyCustomRulesToDocument = useCallback(
    async (
      client: ReturnType<typeof createAnonymizerApiClient>,
      response: DocumentProcessResponse,
    ): Promise<DocumentProcessResponse> => {
      if (productTier !== "early_bird") {
        return response;
      }
      const rules: CustomRegexRulePayload[] = enabledCustomRulePayloads(customRules);
      if (rules.length === 0) {
        return response;
      }
      const analyzed = await client.analyze(response.document.text, rules);
      const anonymized = await client.anonymizeApiEntities(
        response.document.text,
        analyzed.entities,
      );
      return {
        ...response,
        entities: analyzed.entities,
        anonymized_text: anonymized.anonymized_text,
        replacement_map: anonymized.replacement_map,
        offset_map: anonymized.offset_map ?? [],
      };
    },
    [customRules, productTier],
  );

  const runUpdateCheck = useCallback(async (force = false) => {
    setUpdateChecking(true);
    setUpdateError(null);
    setUpdateMessage(null);
    try {
      const result = await checkForUpdate({ force });
      if (result.status === "available") {
        setAvailableUpdate(result.update);
      } else if (result.status === "none") {
        setAvailableUpdate(null);
        setUpdateMessage(texts.updates.upToDate);
      }
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message || texts.updates.checkFailed : texts.updates.checkFailed,
      );
    } finally {
      setUpdateChecking(false);
    }
  }, []);

  const setUpdatePreference = useCallback(
    (consent: boolean) => {
      saveUpdateConsent(consent);
      setUpdateConsentState(consent);
      setShowUpdateConsent(false);
      setUpdateError(null);
      setUpdateMessage(null);
      if (consent) {
        void runUpdateCheck(true);
      } else {
        setAvailableUpdate(null);
      }
    },
    [runUpdateCheck],
  );

  const installAvailableUpdate = useCallback(async () => {
    if (!availableUpdate) {
      return;
    }
    setUpdateInstalling(true);
    setUpdateError(null);
    setDownloadedUpdateBytes(0);
    try {
      await installUpdate(availableUpdate, (event) => {
        if (event.event === "Progress") {
          setDownloadedUpdateBytes((value) => value + event.data.chunkLength);
        }
      });
    } catch (error) {
      setUpdateError(toUserMessage(error));
      setUpdateInstalling(false);
    }
  }, [availableUpdate]);

  useEffect(() => {
    const consent = getUpdateConsent();
    setUpdateConsentState(consent);
    if (consent === null) {
      setShowUpdateConsent(true);
    } else if (consent) {
      void runUpdateCheck(false);
    }
  }, [runUpdateCheck]);

  useEffect(() => {
    setHistoryEnabledState(getDocumentHistoryEnabled());
  }, []);

  useEffect(() => {
    void getAppVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    setCustomRulesState(loadCustomRegexRules());
  }, []);

  useEffect(() => {
    if (anonymization.status === "done") {
      setScreen("flow");
      setWorkspaceView("result");
    }
  }, [anonymization.status]);

  const updateCustomRules = useCallback((rules: CustomRegexRule[]) => {
    setCustomRulesState(rules);
    saveCustomRegexRules(rules);
  }, []);

  const setHistoryEnabled = useCallback(
    (enabled: boolean) => {
      setDocumentHistoryEnabled(enabled);
      setHistoryEnabledState(enabled);
      setHistoryMessage(null);
      setHistoryError(null);
      if (enabled) {
        void loadHistoryEntries();
      }
    },
    [loadHistoryEntries],
  );

  const rememberAuthenticatedSession = useCallback(async (session: AuthenticatedSession) => {
    await saveStoredAuthToken(session.accessToken);
    saveStoredBasicChoice(false);
    setAuthState({ status: "authenticated", session, message: null });
    setAuthError(null);
  }, []);

  const verifyAccountToken = useCallback(async (accessToken: string) => {
    return verifyAuthToken(accessToken, {
      publicKeyPem: getAccountsPublicKeyPem(),
    });
  }, []);

  const refreshSessionSilently = useCallback(
    async (session: AuthenticatedSession) => {
      try {
        const refreshed = await refreshAccountsToken(session.accessToken);
        const verified = await verifyAccountToken(refreshed.access_token);
        await saveStoredAuthToken(verified.accessToken);
        setAuthState((current) =>
          current.status === "authenticated" &&
          current.session.accessToken === session.accessToken
            ? { status: "authenticated", session: verified, message: null }
            : current,
        );
      } catch {
        // Refresh is opportunistic. An offline user keeps the verified local token.
      }
    },
    [verifyAccountToken],
  );

  useEffect(() => {
    let active = true;

    async function restoreAuthState() {
      const token = await readStoredAuthToken();
      if (token) {
        try {
          const session = await verifyAccountToken(token);
          if (!active) {
            return;
          }
          setAuthState({ status: "authenticated", session, message: null });
          setAuthError(null);
          void refreshSessionSilently(session);
          return;
        } catch (error) {
          await clearStoredAuthToken();
          saveStoredBasicChoice(true);
          if (!active) {
            return;
          }
          setAuthState({
            status: "basic",
            message:
              error instanceof AuthTokenError && error.code === "expired"
                ? texts.auth.expired
                : texts.auth.invalidStoredSession,
          });
          return;
        }
      }

      if (getStoredBasicChoice()) {
        setAuthState({ status: "basic", message: null });
      } else {
        setAuthState({ status: "choice_required" });
      }
    }

    void restoreAuthState();
    return () => {
      active = false;
    };
  }, [refreshSessionSilently, verifyAccountToken]);

  useEffect(() => {
    if (screen === "history" && productTier === "early_bird") {
      void loadHistoryEntries();
    }
  }, [loadHistoryEntries, productTier, screen]);

  const refreshEngineHealth = useCallback(
    async (endpoint: EngineEndpoint) => {
      try {
        const health = await createAnonymizerApiClient(endpoint).health();
        setEngineHealthStatus(health.status);
      } catch {
        setEngineHealthStatus(null);
      }
    },
    [setEngineHealthStatus],
  );

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    listenToEngineStatus((event) => {
      if (!active) {
        return;
      }
      if (event.status === "starting") {
        setEngineStarting();
      } else if (event.status === "restarting") {
        setEngineRestarting();
      } else if (event.status === "ready") {
        setEngineReady(event.endpoint);
        void refreshEngineHealth(event.endpoint);
      } else {
        setEngineFailed(event.message);
      }
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((error: unknown) => setEngineFailed(toUserMessage(error)));

    getEngineEndpoint()
      .then((endpoint) => {
        if (active) {
          setEngineReady(endpoint);
          void refreshEngineHealth(endpoint);
        }
      })
      .catch(() => {
        if (active) {
          setEngineStarting();
        }
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [
    refreshEngineHealth,
    setEngineFailed,
    setEngineReady,
    setEngineRestarting,
    setEngineStarting,
  ]);

  const processFile = useCallback(
    async (file: File) => {
      if (!isSupportedDocumentName(file.name)) {
        setProcessingError(texts.errors.unsupportedFile);
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setProcessingError(texts.errors.payloadTooLarge);
        return;
      }

      let endpoint = uiState.endpoint;
      if (!endpoint) {
        try {
          endpoint = await getEngineEndpoint();
          setEngineReady(endpoint);
          void refreshEngineHealth(endpoint);
        } catch {
          setProcessingError(texts.errors.noEngine);
          return;
        }
      }

      const timers: number[] = [];
      setProcessing("parsing");
      if (uiState.forceOcr) {
        timers.push(window.setTimeout(() => setProcessing("ocr"), 500));
        timers.push(window.setTimeout(() => setProcessing("detecting"), 1200));
      } else {
        timers.push(window.setTimeout(() => setProcessing("detecting"), 600));
      }

      try {
        const client = createAnonymizerApiClient(endpoint);
        const response = await applyCustomRulesToDocument(
          client,
          await client.processDocument(file, { forceOcr: uiState.forceOcr }),
        );
        setProcessedDocument(response, file);
        setScreen("flow");
        setWorkspaceView("document");
      } catch (error) {
        setProcessingError(toUserMessage(error));
      } finally {
        timers.forEach(window.clearTimeout);
      }
    },
    [
      setEngineReady,
      refreshEngineHealth,
      applyCustomRulesToDocument,
      setProcessedDocument,
      setProcessing,
      setProcessingError,
      uiState.endpoint,
      uiState.forceOcr,
    ],
  );

  const chooseFile = useCallback(async () => {
    let file: File | null = null;
    try {
      file = await pickDocumentFile();
    } catch {
      try {
        file = await pickBrowserDocumentFile();
      } catch (error) {
        setProcessingError(toUserMessage(error));
      }
    }
    if (file) {
      await processFile(file);
    }
  }, [processFile, setProcessingError]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listenToDroppedFiles(async (paths) => {
      if (paths.length !== 1) {
        setProcessingError(texts.errors.droppedMany);
        return;
      }
      try {
        await processFile(await fileFromPath(paths[0]));
      } catch (error) {
        setProcessingError(toUserMessage(error));
      }
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        unlisten = null;
      });

    return () => {
      unlisten?.();
    };
  }, [processFile, setProcessingError]);

  const redetect = useCallback(async () => {
    if (uiState.selectedFile) {
      await processFile(uiState.selectedFile);
    }
  }, [processFile, uiState.selectedFile]);

  const resolveEndpoint = useCallback(async (): Promise<EngineEndpoint | null> => {
    if (uiState.endpoint) {
      return uiState.endpoint;
    }
    try {
      const endpoint = await getEngineEndpoint();
      setEngineReady(endpoint);
      void refreshEngineHealth(endpoint);
      return endpoint;
    } catch {
      return null;
    }
  }, [refreshEngineHealth, setEngineReady, uiState.endpoint]);

  const appendBatchFiles = useCallback((files: File[]) => {
    const supported = files.filter(
      (file) => isSupportedDocumentName(file.name) && file.size <= MAX_UPLOAD_BYTES,
    );
    const skipped = files.length - supported.length;

    if (supported.length > 0) {
      setBatchItems((items) => [...items, ...createBatchQueueItems(supported)]);
      setBatchMessage(texts.batch.added(supported.length));
      setBatchError(null);
    }
    if (skipped > 0) {
      setBatchError(texts.batch.skippedUnsupported(skipped));
    }
  }, []);

  const addBatchFiles = useCallback(async () => {
    try {
      let files = await pickDocumentFiles();
      if (files.length === 0) {
        files = await pickBrowserDocumentFiles();
      }
      appendBatchFiles(files);
    } catch (error) {
      setBatchError(toUserMessage(error));
    }
  }, [appendBatchFiles]);

  const addBatchFolder = useCallback(async () => {
    try {
      appendBatchFiles(await pickDocumentFolderFiles());
    } catch (error) {
      setBatchError(toUserMessage(error));
    }
  }, [appendBatchFiles]);

  const patchBatchItem = useCallback((itemId: string, patch: BatchItemPatch) => {
    setBatchItems((items) =>
      items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    );
  }, []);

  const runBatch = useCallback(async () => {
    if (batchItems.length === 0 || batchRunning || productTier !== "early_bird") {
      return;
    }
    const endpoint = await resolveEndpoint();
    if (!endpoint) {
      setBatchError(texts.errors.noEngine);
      return;
    }
    setBatchRunning(true);
    setBatchMessage(null);
    setBatchError(null);
    try {
      const client = createAnonymizerApiClient(endpoint);
      await processBatchQueue(
        batchItems,
        async (item): Promise<BatchProcessSuccess> => {
          const processed = await applyCustomRulesToDocument(
            client,
            await client.processDocument(item.file, { forceOcr: uiState.forceOcr }),
          );
          return {
            document: processed.document,
            anonymizedText: processed.anonymized_text,
            replacementMap: processed.replacement_map,
            entityCount: processed.entities.length,
          };
        },
        patchBatchItem,
      );
      setBatchMessage(texts.batch.done);
    } catch (error) {
      setBatchError(toUserMessage(error));
    } finally {
      setBatchRunning(false);
    }
  }, [
    applyCustomRulesToDocument,
    batchItems,
    batchRunning,
    patchBatchItem,
    productTier,
    resolveEndpoint,
    uiState.forceOcr,
  ]);

  const exportBatch = useCallback(async () => {
    const readyItems = batchItems
      .filter((item) => item.status === "done" && item.anonymizedText && item.replacementMap)
      .map((item) => ({
        filename: item.filename,
        anonymizedText: item.anonymizedText!,
        replacementMap: item.replacementMap!,
      }));
    if (readyItems.length === 0) {
      setBatchError(texts.batch.noReadyResults);
      return;
    }
    try {
      const directory = await pickOutputDirectory();
      if (!directory) {
        return;
      }
      const count = await exportBatchResultsToDirectory(directory, readyItems);
      setBatchMessage(texts.batch.exportDone(count));
      setBatchError(null);
    } catch (error) {
      setBatchError(toUserMessage(error));
    }
  }, [batchItems]);

  const clearBatch = useCallback(() => {
    if (batchRunning) {
      return;
    }
    setBatchItems([]);
    setBatchMessage(null);
    setBatchError(null);
  }, [batchRunning]);

  const anonymizeDocument = useCallback(async () => {
    if (!document) {
      setAnonymizationError(texts.errors.noDocument);
      return;
    }
    const endpoint = await resolveEndpoint();
    if (!endpoint) {
      setAnonymizationError(texts.errors.noEngine);
      return;
    }
    setAnonymizationLoading();
    try {
      const client = createAnonymizerApiClient(endpoint);
      const result = await client.anonymize(document.text, entities);
      setAnonymizationResult(
        result.anonymized_text,
        result.replacement_map,
        result.offset_map ?? [],
      );
      if (productTier === "early_bird") {
        try {
          const saved = await saveDocumentHistoryEntryIfEnabled({
            document,
            entities,
            anonymizedText: result.anonymized_text,
            replacementMap: result.replacement_map,
            offsetMap: result.offset_map ?? [],
          });
          if (saved) {
            setHistoryMessage(texts.history.saved);
            if (screen === "history") {
              void loadHistoryEntries();
            }
          }
        } catch {
          setHistoryError(texts.history.saveFailed);
        }
      }
    } catch (error) {
      setAnonymizationError(toUserMessage(error));
    }
  }, [
    document,
    entities,
    resolveEndpoint,
    setAnonymizationError,
    setAnonymizationLoading,
    setAnonymizationResult,
    productTier,
    screen,
    loadHistoryEntries,
  ]);

  const openHistoryEntry = useCallback(
    async (entryId: number) => {
      setHistoryError(null);
      try {
        const entry = await tauriDocumentHistoryBackend.get(entryId);
        if (!entry) {
          await loadHistoryEntries();
          return;
        }
        restoreDocumentSession(entry.session);
        setScreen("flow");
        setWorkspaceView("result");
      } catch (error) {
        setHistoryError(toUserMessage(error) || texts.history.loadFailed);
      }
    },
    [loadHistoryEntries, restoreDocumentSession],
  );

  const deleteHistoryEntry = useCallback(
    async (entryId: number) => {
      const confirmed = await confirmSensitiveAction(
        texts.history.deleteConfirm,
        texts.history.deleteConfirmTitle,
      );
      if (!confirmed) {
        return;
      }
      try {
        await tauriDocumentHistoryBackend.delete(entryId);
        await loadHistoryEntries();
      } catch (error) {
        setHistoryError(toUserMessage(error));
      }
    },
    [loadHistoryEntries],
  );

  const clearHistory = useCallback(async () => {
    const confirmed = await confirmSensitiveAction(
      texts.history.clearConfirm,
      texts.history.clearConfirmTitle,
    );
    if (!confirmed) {
      return;
    }
    try {
      await tauriDocumentHistoryBackend.clear();
      await loadHistoryEntries();
    } catch (error) {
      setHistoryError(toUserMessage(error));
    }
  }, [loadHistoryEntries]);

  const copyAnonymizedDocument = useCallback(async () => {
    if (anonymization.anonymizedText) {
      await copyText(anonymization.anonymizedText);
    }
  }, [anonymization.anonymizedText]);

  const saveReplacementMap = useCallback(async () => {
    if (!anonymization.replacementMap) {
      return;
    }
    const confirmed = await confirmSensitiveAction(
      texts.generation.mapWarning,
      texts.generation.mapWarningTitle,
    );
    if (!confirmed) {
      return;
    }
    await saveJsonFile(
      "mapa-zastapien.json",
      JSON.stringify(anonymization.replacementMap, null, 2),
    );
  }, [anonymization.replacementMap]);

  const exportDocument = useCallback(
    async (format: ExportFormat) => {
      if (!anonymization.anonymizedText) {
        return;
      }
      const endpoint = await resolveEndpoint();
      if (!endpoint) {
        setAnonymizationError(texts.errors.noEngine);
        return;
      }
      try {
        const client = createAnonymizerApiClient(endpoint);
        const blob = await client.exportDocument({
          anonymizedText: anonymization.anonymizedText,
          format,
          blocks: blocksForExport(anonymization.anonymizedText),
        });
        await saveBinaryFile(`anonimizowany.${format}`, blob, format);
      } catch (error) {
        setAnonymizationError(toUserMessage(error));
      }
    },
    [anonymization.anonymizedText, resolveEndpoint, setAnonymizationError],
  );

  const loadPrompts = useCallback(async () => {
    const endpoint = await resolveEndpoint();
    if (!endpoint) {
      setPromptsError(texts.errors.noEngine);
      return;
    }
    setPromptsLoading();
    try {
      const client = createAnonymizerApiClient(endpoint);
      setPrompts(await client.listPrompts());
    } catch (error) {
      setPromptsError(toUserMessage(error));
    }
  }, [resolveEndpoint, setPrompts, setPromptsError, setPromptsLoading]);

  const copyPrompt = useCallback(async (text: string) => {
    await copyText(text);
  }, []);

  const deanonymizeText = useCallback(async () => {
    const replacementMap = deanonymization.replacementMap;
    if (!replacementMap) {
      setDeanonymizationError(texts.errors.noReplacementMap);
      return;
    }
    const endpoint = await resolveEndpoint();
    if (!endpoint) {
      setDeanonymizationError(texts.errors.noEngine);
      return;
    }
    setDeanonymizationLoading();
    try {
      const client = createAnonymizerApiClient(endpoint);
      const result = await client.deanonymize(deanonymization.input, replacementMap);
      setDeanonymizationResult(result.original_text, result.warnings ?? []);
    } catch (error) {
      setDeanonymizationError(toUserMessage(error));
    }
  }, [
    deanonymization.input,
    deanonymization.replacementMap,
    resolveEndpoint,
    setDeanonymizationError,
    setDeanonymizationLoading,
    setDeanonymizationResult,
  ]);

  const loadReplacementMap = useCallback(async () => {
    try {
      const json = await pickReplacementMapFile();
      if (!json) {
        return;
      }
      setDeanonymizationMap(JSON.parse(json) as ReplacementMap, "file");
    } catch (error) {
      setDeanonymizationError(toUserMessage(error));
    }
  }, [setDeanonymizationError, setDeanonymizationMap]);

  const copyDeanonymizedResult = useCallback(async () => {
    if (deanonymization.result) {
      await copyText(deanonymization.result);
    }
  }, [deanonymization.result]);

  const continueBasic = useCallback(async () => {
    await clearStoredAuthToken();
    saveStoredBasicChoice(true);
    setAuthError(null);
    setAuthState({ status: "basic", message: null });
  }, []);

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      setAuthActionLoading(true);
      setAuthError(null);
      try {
        const response = await loginToAccounts(credentials);
        const session = await verifyAccountToken(response.access_token);
        await rememberAuthenticatedSession(session);
      } catch (error) {
        setAuthError(authErrorMessage(error));
      } finally {
        setAuthActionLoading(false);
      }
    },
    [rememberAuthenticatedSession, verifyAccountToken],
  );

  const loginWithBrowser = useCallback(async () => {
    setBrowserLoginLoading(true);
    setAuthError(null);
    try {
      const response = await loginViaBrowser();
      const session = await verifyAccountToken(response.access_token);
      await rememberAuthenticatedSession(session);
    } catch (error) {
      setAuthError(authErrorMessage(error));
    } finally {
      setBrowserLoginLoading(false);
    }
  }, [rememberAuthenticatedSession, verifyAccountToken]);

  const logout = useCallback(async () => {
    await clearStoredAuthToken();
    saveStoredBasicChoice(true);
    setAuthError(null);
    setAuthState({ status: "basic", message: null });
  }, []);

  const openRegistration = useCallback(() => {
    void openExternalUrl(getRegistrationUrl()).catch((error) => {
      setAuthError(toUserMessage(error) || String(error));
    });
  }, []);

  const openKancelariaSite = useCallback(() => {
    void openExternalUrl(texts.footer.kancelariaHref).catch(() => {
      // Link informacyjny - niepowodzenie otwarcia przeglądarki nie blokuje pracy.
    });
  }, []);

  const openLawternSite = useCallback(() => {
    void openExternalUrl(texts.footer.lawternHref).catch(() => {
      // Link informacyjny - niepowodzenie otwarcia przeglądarki nie blokuje pracy.
    });
  }, []);

  const startNewDocument = useCallback(() => {
    resetDocument();
    setScreen("flow");
    setWorkspaceView("document");
  }, [resetDocument]);

  useEffect(() => {
    if (!import.meta.env.VITE_ANONYMIZER_E2E) {
      return;
    }

    const closeE2eModals = () => {
      setShowUpdateConsent(false);
      setAvailableUpdate(null);
      setAuthError(null);
      setScreen("flow");
    };

    window.__ANONYMIZER_E2E__ = {
      importDocument: async (path: string) => {
        await processFile(await fileFromPath(path));
      },
      addManualEntityByText: (text: string, category = "CUSTOM") => {
        const state = useAppStore.getState();
        const currentDocument = state.document;
        if (!currentDocument) {
          throw new Error("No document loaded.");
        }
        const start = currentDocument.text.indexOf(text);
        if (start === -1) {
          throw new Error(`Text not found in document: ${text}`);
        }
        state.addManualEntity(
          { start, end: start + text.length },
          category as EntityCategory,
          null,
        );
      },
      enableEarlyBird: () => {
        closeE2eModals();
        setAuthState({
          status: "authenticated",
          session: {
            accessToken: "e2e-token",
            accountId: "00000000-0000-4000-8000-000000000000",
            email: "e2e@example.com",
            tier: "early_bird",
            issuedAt: 1,
            expiresAt: Math.floor(Date.now() / 1000) + 2_592_000,
          },
          message: null,
        });
      },
      useBasicTier: () => {
        closeE2eModals();
        setAuthState({ status: "basic", message: null });
      },
      openLatestHistoryEntry: async () => {
        const entries = await tauriDocumentHistoryBackend.list();
        if (entries.length === 0) {
          throw new Error("No document history entries.");
        }
        const entry = await tauriDocumentHistoryBackend.get(entries[0].id);
        if (!entry) {
          throw new Error("Document history entry not found.");
        }
        restoreDocumentSession(entry.session);
        setScreen("flow");
        setWorkspaceView("result");
      },
      setHistoryEnabled,
      rejectFirstEntityContaining: (text: string) => {
        const state = useAppStore.getState();
        const entity = state.entities.find((item) => item.text.includes(text));
        if (!entity) {
          throw new Error(`Entity not found: ${text}`);
        }
        state.setEntityStatus(entity.id, "rejected");
      },
      readClipboard: readClipboardText,
      openScreen: setScreen,
      setWorkspaceView,
      storeApi: useAppStore,
      snapshot: () => {
        const state = useAppStore.getState();
        return {
          anonymizedText: state.anonymization.anonymizedText,
          batchDone: batchItems.filter((item) => item.status === "done").length,
          batchErrors: batchItems.filter((item) => item.status === "error").length,
          batchTotal: batchItems.length,
          deanonymizedText: state.deanonymization.result,
          entityCount: state.entities.length,
          engineError: state.uiState.engineError,
          engineHealthStatus: state.uiState.engineHealthStatus,
          engineStatus: state.uiState.engineStatus,
          processingError: state.uiState.processingError,
          processingStatus: state.uiState.processingStatus,
          productTier,
        };
      },
    };

    return () => {
      delete window.__ANONYMIZER_E2E__;
    };
  }, [batchItems, processFile, productTier, restoreDocumentSession, setHistoryEnabled]);

  if (authState.status === "loading") {
    return (
      <main className="auth-shell">
        <section className="auth-loading">
          <p className="screen-eyebrow">{texts.appTitle}</p>
          <h1>{texts.auth.loading}</h1>
        </section>
        <AppFooter onOpenKancelaria={openKancelariaSite} onOpenLawtern={openLawternSite} />
      </main>
    );
  }

  if (authState.status === "choice_required") {
    return (
      <AuthStartScreen
        error={authError}
        loading={authActionLoading}
        browserLoginLoading={browserLoginLoading}
        onLogin={login}
        onLoginBrowser={() => void loginWithBrowser()}
        onRegister={openRegistration}
        onContinueBasic={continueBasic}
        onOpenKancelaria={openKancelariaSite}
        onOpenLawtern={openLawternSite}
      />
    );
  }

  const hasDocument = Boolean(document);
  const hasResult = Boolean(anonymization.replacementMap);

  return (
    <div className="app-shell">
      <div className="app-shell__body">
        <aside className="app-sidebar">
          <div className="app-sidebar__brand">
            <button
              className="app-sidebar__brand-button"
              type="button"
              aria-label={texts.nav.goHome}
              onClick={() => setScreen("flow")}
            >
              <img src={images.icon} alt="" />
              <span>{texts.appTitle}</span>
            </button>
          </div>

          <nav className="app-sidebar__nav" aria-label={texts.nav.stepsSection}>
            <div className="app-sidebar__section">{texts.nav.stepsSection}</div>
            <button
              className={navItemClass(screen === "flow" && !hasDocument, hasDocument)}
              type="button"
              onClick={() => setScreen("flow")}
            >
              <span className="nav-item__num" aria-hidden="true">
                {hasDocument ? "✓" : "1"}
              </span>
              <span>{texts.steps.import}</span>
            </button>
            <button
              className={navItemClass(
                screen === "flow" && hasDocument && workspaceView === "document",
                hasResult,
              )}
              type="button"
              disabled={!hasDocument}
              onClick={() => {
                setScreen("flow");
                setWorkspaceView("document");
              }}
            >
              <span className="nav-item__num" aria-hidden="true">
                {hasResult ? "✓" : "2"}
              </span>
              <span>{texts.steps.review}</span>
            </button>
            <button
              className={navItemClass(screen === "flow" && workspaceView === "result", false)}
              type="button"
              disabled={!hasResult}
              onClick={() => {
                setScreen("flow");
                setWorkspaceView("result");
              }}
            >
              <span className="nav-item__num" aria-hidden="true">
                3
              </span>
              <span>{texts.steps.result}</span>
            </button>

            <div className="app-sidebar__section app-sidebar__section--tools">
              {texts.nav.toolsSection}
            </div>
            <button
              className={navItemClass(screen === "flow" && workspaceView === "compare", false)}
              type="button"
              disabled={!hasDocument}
              onClick={() => {
                setScreen("flow");
                setWorkspaceView("compare");
              }}
            >
              <span>{texts.nav.compare}</span>
              {productTier === "basic" ? (
                <span className="nav-item__badge" aria-hidden="true">
                  {texts.nav.earlyBirdBadge}
                </span>
              ) : null}
            </button>
            <button
              className={navItemClass(screen === "history", false)}
              type="button"
              onClick={() => setScreen("history")}
            >
              <span>{texts.nav.history}</span>
              {productTier === "basic" ? (
                <span className="nav-item__badge" aria-hidden="true">
                  {texts.nav.earlyBirdBadge}
                </span>
              ) : null}
            </button>
            <button
              className={navItemClass(screen === "batch", false)}
              type="button"
              onClick={() => setScreen("batch")}
            >
              <span>{texts.nav.batch}</span>
              {productTier === "basic" ? (
                <span className="nav-item__badge" aria-hidden="true">
                  {texts.nav.earlyBirdBadge}
                </span>
              ) : null}
            </button>
          </nav>

          <div className="app-sidebar__spacer" />

          <div className="app-sidebar__status">
            <span className={`engine-pill engine-pill--${uiState.engineStatus}`}>
              {engineLabel(uiState.engineStatus)}
            </span>
          </div>

          <nav className="app-sidebar__nav app-sidebar__nav--bottom" aria-label={texts.nav.settings}>
            <button
              className={navItemClass(screen === "settings", false)}
              type="button"
              aria-label={texts.updates.settings}
              onClick={() => setScreen("settings")}
            >
              <span>{texts.nav.settings}</span>
            </button>
          </nav>

          <div className="app-sidebar__account">
            {authState.status === "authenticated" ? (
              <>
                <div className="app-sidebar__account-title">{texts.sidebar.accountEarlyBird}</div>
                <div className="app-sidebar__account-note">{authState.session.email}</div>
                <button
                  className="app-sidebar__account-link"
                  type="button"
                  onClick={() => void logout()}
                >
                  {texts.sidebar.logout}
                </button>
              </>
            ) : (
              <>
                <div className="app-sidebar__account-title">{texts.sidebar.accountBasicTitle}</div>
                <div className="app-sidebar__account-note">{texts.sidebar.accountBasicHint}</div>
                <button
                  className="app-sidebar__account-link"
                  type="button"
                  onClick={openRegistration}
                >
                  {texts.sidebar.register}
                </button>
              </>
            )}
          </div>
        </aside>

        <main className="app-main">
          {uiState.engineHealthStatus === "degraded" ? (
            <div className="degraded-banner" role="status">
              {texts.engine.degradedBanner}
            </div>
          ) : null}

          <div className="app-main__scroll">
            {screen === "flow" ? (
              uiState.engineStatus === "failed" ? (
                <EngineError message={uiState.engineError} />
              ) : document ? (
                <DocumentWorkspace
                  document={document}
                  entities={entities}
                  entityGroups={entityGroups}
                  hiddenCategories={uiState.hiddenCategories}
                  anonymization={anonymization}
                  prompts={prompts}
                  deanonymization={deanonymization}
                  processingStatus={uiState.processingStatus}
                  processingError={uiState.processingError}
                  view={workspaceView}
                  onViewChange={setWorkspaceView}
                  onToggleCategory={toggleCategory}
                  onRedetect={redetect}
                  onNewDocument={startNewDocument}
                  onAnonymize={anonymizeDocument}
                  onCopyDocument={copyAnonymizedDocument}
                  onSaveMap={saveReplacementMap}
                  onExport={exportDocument}
                  onLoadPrompts={loadPrompts}
                  onPromptSearch={setPromptSearch}
                  onSelectPrompt={setSelectedPrompt}
                  onCopyPrompt={copyPrompt}
                  onDeanonymizationInput={setDeanonymizationInput}
                  onDeanonymize={deanonymizeText}
                  onLoadReplacementMap={loadReplacementMap}
                  onCopyDeanonymizedResult={copyDeanonymizedResult}
                  tier={productTier}
                  onRegister={openRegistration}
                  canRedetect={Boolean(uiState.selectedFile)}
                />
              ) : (
                <StartScreen
                  engineStatus={uiState.engineStatus}
                  processingStatus={uiState.processingStatus}
                  processingStep={uiState.processingStep}
                  processingError={uiState.processingError}
                  forceOcr={uiState.forceOcr}
                  fileName={uiState.selectedFileName}
                  onChooseFile={chooseFile}
                  onDropFile={processFile}
                />
              )
            ) : null}

            {screen === "history" ? (
              <section className="screen screen--history" key="history">
                <TierGate
                  tier={productTier}
                  featureName={texts.history.title}
                  onRegister={openRegistration}
                  variant="card"
                  description={texts.history.gateDescription}
                  onBack={
                    hasResult
                      ? () => {
                          setScreen("flow");
                          setWorkspaceView("result");
                        }
                      : undefined
                  }
                >
                  {!historyEnabled ? (
                    <div className="gate-card">
                      <h3>{texts.history.disabledTitle}</h3>
                      <p>{texts.history.disabledBody}</p>
                      <div className="toolbar">
                        <button
                          className="primary-button"
                          type="button"
                          onClick={() => setHistoryEnabled(true)}
                        >
                          {texts.history.enable}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="screen__header">
                        <div className="screen__header-text">
                          <h2 className="screen-title">{texts.history.heading}</h2>
                          <p className="screen-lead">{texts.history.lead}</p>
                        </div>
                        <button
                          className="danger-button danger-button--compact"
                          type="button"
                          disabled={historyEntries.length === 0}
                          onClick={() => void clearHistory()}
                        >
                          {texts.history.clear}
                        </button>
                      </div>
                      {historyLoading ? <p className="muted">{texts.history.loading}</p> : null}
                      {historyMessage ? <p className="status-note">{historyMessage}</p> : null}
                      {historyError ? <p className="error-note">{historyError}</p> : null}
                      <div className="card history-list-card">
                        {!historyLoading && historyEntries.length === 0 ? (
                          <div className="history-empty">
                            <strong>{texts.history.empty}</strong>
                            <p>{texts.history.emptyHint}</p>
                          </div>
                        ) : (
                          historyEntries.map((entry) => (
                            <article className="history-item" key={entry.id}>
                              <FileIcon />
                              <span className="history-item__name">{entry.filename}</span>
                              <span className="history-item__meta">
                                {formatHistoryDate(entry.createdAt)} ·{" "}
                                {entry.documentFormat.toUpperCase()} ·{" "}
                                {entry.acceptedEntityCount}/{entry.entityCount}{" "}
                                {texts.history.savedEntities}
                              </span>
                              <div className="history-item__actions">
                                <button
                                  className="secondary-button secondary-button--compact"
                                  type="button"
                                  onClick={() => void openHistoryEntry(entry.id)}
                                >
                                  {texts.history.open}
                                </button>
                                <button
                                  className="ghost-button ghost-button--compact"
                                  type="button"
                                  onClick={() => void deleteHistoryEntry(entry.id)}
                                >
                                  {texts.history.delete}
                                </button>
                              </div>
                            </article>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </TierGate>
              </section>
            ) : null}

            {screen === "batch" ? (
              <section className="screen screen--batch" key="batch">
                <TierGate
                  tier={productTier}
                  featureName={texts.batch.title}
                  onRegister={openRegistration}
                  variant="card"
                  description={texts.batch.gateDescription}
                  onBack={
                    hasResult
                      ? () => {
                          setScreen("flow");
                          setWorkspaceView("result");
                        }
                      : undefined
                  }
                >
                  <BatchPanel
                    items={batchItems}
                    running={batchRunning}
                    message={batchMessage}
                    error={batchError}
                    disabled={uiState.engineStatus !== "ready"}
                    onAddFiles={addBatchFiles}
                    onAddFolder={addBatchFolder}
                    onRun={runBatch}
                    onExport={exportBatch}
                    onClear={clearBatch}
                  />
                </TierGate>
              </section>
            ) : null}

            {screen === "settings" ? (
              <section className="screen screen--narrow">
                <h2 className="screen-title">{texts.settings.title}</h2>
                <AccountSettings
                  authState={authState}
                  error={authError}
                  loading={authActionLoading}
                  onLogin={login}
                  onRegister={openRegistration}
                  onLogout={() => void logout()}
                />
                <section className="settings-section">
                  <h3>{texts.updates.sectionTitle}</h3>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={updateConsent === true}
                      onChange={(event) => setUpdatePreference(event.currentTarget.checked)}
                    />
                    <span>
                      {texts.updates.enabledLabel}
                      <span className="checkbox-row__note">{texts.updates.enabledNote}</span>
                    </span>
                  </label>
                  {updateConsent === false ? (
                    <p className="muted">{texts.updates.disabledNote}</p>
                  ) : null}
                  {updateMessage ? <p className="status-note">{updateMessage}</p> : null}
                  {updateError ? <p className="error-note">{updateError}</p> : null}
                  <div className="settings-actions">
                    <button
                      className="secondary-button secondary-button--compact"
                      type="button"
                      disabled={updateConsent !== true || updateChecking}
                      onClick={() => void runUpdateCheck(true)}
                    >
                      {updateChecking ? texts.updates.checking : texts.updates.checkNow}
                    </button>
                  </div>
                </section>
                <TierGate
                  tier={productTier}
                  featureName={texts.customRules.title}
                  onRegister={openRegistration}
                >
                  <section className="settings-section">
                    <h3>{texts.customRules.heading}</h3>
                    <p className="muted">{texts.customRules.lead}</p>
                    <CustomRulesPanel rules={customRules} onChange={updateCustomRules} />
                  </section>
                </TierGate>
                <TierGate
                  tier={productTier}
                  featureName={texts.history.title}
                  onRegister={openRegistration}
                >
                  <section className="settings-section">
                    <h3>{texts.history.heading}</h3>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={historyEnabled}
                        onChange={(event) => setHistoryEnabled(event.currentTarget.checked)}
                      />
                      <span>
                        {texts.history.enabledLabel}
                        <span className="checkbox-row__note">
                          {texts.history.settingsDescription}
                        </span>
                      </span>
                    </label>
                    {historyMessage ? <p className="status-note">{historyMessage}</p> : null}
                    {historyError ? <p className="error-note">{historyError}</p> : null}
                    <div className="settings-actions">
                      <button
                        className="secondary-button secondary-button--compact"
                        type="button"
                        onClick={() => setScreen("history")}
                      >
                        {texts.history.button}
                      </button>
                      <button
                        className="danger-button danger-button--compact"
                        type="button"
                        onClick={() => void clearHistory()}
                      >
                        {texts.history.clear}
                      </button>
                    </div>
                  </section>
                </TierGate>
                <section className="settings-section">
                  <h3>{texts.settings.advanced}</h3>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={uiState.forceOcr}
                      onChange={(event) => setForceOcr(event.currentTarget.checked)}
                    />
                    <span>
                      {texts.start.forceOcr}
                      <span className="checkbox-row__note">{texts.start.forceOcrNote}</span>
                    </span>
                  </label>
                </section>
                <p className="settings-version">
                  {texts.account.version}
                  {appVersion ? ` ${appVersion}` : ""}
                </p>
              </section>
            ) : null}
          </div>
        </main>
      </div>

      <AppFooter onOpenKancelaria={openKancelariaSite} onOpenLawtern={openLawternSite} />

      {showUpdateConsent ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel">
            <h2>{texts.updates.consentTitle}</h2>
            <p>{texts.updates.consentBody}</p>
            <p>{texts.updates.consentBody2}</p>
            <div className="modal-actions">
              <button className="primary-button" onClick={() => setUpdatePreference(true)}>
                {texts.updates.enableChecks}
              </button>
              <button className="secondary-button" onClick={() => setUpdatePreference(false)}>
                {texts.updates.disableChecks}
              </button>
            </div>
            <p className="modal-panel__footnote">{texts.updates.consentFootnote}</p>
          </section>
        </div>
      ) : null}

      {availableUpdate ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel modal-panel--wide">
            <h2>{texts.updates.updateTitle}</h2>
            <dl className="update-details">
              <div>
                <dt>{texts.updates.currentVersion}</dt>
                <dd>{availableUpdate.currentVersion}</dd>
              </div>
              <div>
                <dt>{texts.updates.newVersion}</dt>
                <dd>{availableUpdate.version}</dd>
              </div>
            </dl>
            {availableUpdate.body ? (
              <div className="update-notes">
                <h3>{texts.updates.changelog}</h3>
                <pre>{availableUpdate.body}</pre>
              </div>
            ) : null}
            {downloadedUpdateBytes > 0 ? (
              <p className="muted">{Math.round(downloadedUpdateBytes / 1024 / 1024)} MB</p>
            ) : null}
            {updateError ? <p className="error-note">{updateError}</p> : null}
            <div className="modal-actions">
              <button
                className="primary-button"
                disabled={updateInstalling}
                onClick={() => void installAvailableUpdate()}
              >
                {updateInstalling ? texts.updates.installing : texts.updates.install}
              </button>
              <button
                className="secondary-button"
                disabled={updateInstalling}
                onClick={() => setAvailableUpdate(null)}
              >
                {texts.updates.close}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function navItemClass(active: boolean, done: boolean): string {
  return `nav-item ${active ? "nav-item--active" : ""} ${done ? "nav-item--done" : ""}`;
}

function engineLabel(status: string): string {
  if (status === "ready") {
    return texts.engine.readyLabel;
  }
  if (status === "restarting") {
    return texts.engine.restartingLabel;
  }
  if (status === "failed") {
    return texts.engine.failedLabel;
  }
  return texts.engine.startingLabel;
}

function authErrorMessage(error: unknown): string {
  if (error instanceof AccountsClientError && error.code === "network") {
    return texts.auth.loginNetwork;
  }
  if (error instanceof AccountsClientError) {
    return error.message;
  }
  if (error instanceof AuthTokenError) {
    return error.message;
  }
  return toUserMessage(error) || texts.auth.loginNetwork;
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default App;
