import { useCallback, useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";

import "./App.css";
import { createAnonymizerApiClient } from "./api/client";
import { toUserMessage } from "./api/errors";
import {
  AccountsClientError,
  getAccountDeletionUrl,
  loginToAccounts,
  refreshAccountsToken,
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
import { ExcludedCategoriesSettings } from "./components/ExcludedCategoriesSettings";
import { FinderMenuSettings, IS_MACOS } from "./components/FinderMenuSettings";
import { ReplacementModeSettings } from "./components/ReplacementModeSettings";
import {
  loadMaskFaces,
  loadProfile,
  loadReplacementMode,
  saveMaskFaces,
  saveProfile,
  saveReplacementMode,
} from "./tauri/replacementMode";
import { StartScreen } from "./components/StartScreen";
import { TierGate } from "./components/TierGate";
import {
  createBatchQueueItems,
  processBatchQueue,
  type BatchItemPatch,
} from "./domain/batchProcessing";
import { enabledCustomRulePayloads } from "./domain/customRules";
import { poufnikFileName } from "./domain/batchExport";
import {
  buildAnonymizedExport,
  buildOwnFormatExport,
  ownExportFormat,
  type AnonymizedExportPlatform,
} from "./domain/anonymizedExport";
import { rejectExcludedCategories } from "./domain/entities";
import {
  filenameOf,
  isRestorableFileName,
  restorableText,
  restoreFileContents,
  restoredFileName,
  runShellAction,
  type ShellActionOutcome,
} from "./domain/shellActions";
import { chooseReplacementMap, parseReplacementMap, type MapCandidate } from "./domain/mapLinking";
import { decryptMap, encryptMap, isEncryptedMap } from "./domain/mapCrypto";
import { originalPreviewKind, previewKind } from "./domain/preview";
import { buildReportRequest, sha256Hex } from "./domain/report";
import { DocumentPreviewPair, type PreviewFile } from "./components/DocumentPreviewPair";
import { MapPasswordForm } from "./components/MapPasswordForm";
import { anonymizeClipboard, restoreClipboard } from "./domain/clipboardActions";
import { restoreWarningMessage } from "./domain/restoreWarnings";
import {
  loadHotkeysEnabled,
  registerClipboardShortcuts,
  saveHotkeysEnabled,
} from "./tauri/hotkeys";
import { DeanonymizePanel } from "./components/DeanonymizePanel";
import {
  FileRestorePanel,
  IDLE_FILE_RESTORE,
  type FileRestoreState,
} from "./components/FileRestorePanel";
import { convertToDocx, getPdfRenderer, renderDocxToPdf } from "./tauri/pdf";
import { CONVERTED_NOTICE, prepareDocument } from "./domain/legacyFormats";
import { texts } from "./i18n";
import { useAppStore } from "./store/useAppStore";
import { getAppVersion } from "./tauri/app";
import { copyText, readClipboardText } from "./tauri/clipboard";
import { loadCustomRegexRules, saveCustomRegexRules } from "./tauri/customRules";
import { loadExcludedCategories, saveExcludedCategories } from "./tauri/excludedCategories";
import { getEngineEndpoint, getEngineStatus, listenToEngineStatus } from "./tauri/engine";
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
  IS_MAC_APP_STORE,
  UPDATES_MANAGED_BY_STORE,
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
  pickRestorableFile,
  pickBrowserRestorableFile,
  pickBrowserDocumentFile,
  pickDocumentFile,
  pickDocumentFiles,
  pickDocumentFolderFiles,
  pickOutputDirectory,
  saveBinaryFile,
  saveJsonFile,
} from "./tauri/files";
import { openExternalUrl } from "./tauri/external";
import {
  deleteRememberedMaps,
  finishShellActions,
  findReplacementMaps,
  listenToShellActions,
  loadRememberMaps,
  notify,
  pathExists,
  readTextFile,
  rememberReplacementMap,
  removeExpiredMaps,
  saveRememberMaps,
  takeShellActions,
  waitForEngine,
  writeOutputFile,
} from "./tauri/shellActions";
import { FileIcon } from "./ui/icons";
import type {
  CustomRegexRule,
  CustomRegexRulePayload,
  BatchQueueItem,
  BatchProcessSuccess,
  DocumentProcessResponse,
  EngineEndpoint,
  EngineStatusEvent,
  EntityCategory,
  ExportFormat,
  ReplacementMap,
} from "./types";

type AppScreen = "flow" | "history" | "batch" | "restore" | "settings";

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
      /** Builds the export like the buttons do and returns it base64-encoded (no save dialog). */
      exportFile: (format: ExportFormat) => Promise<string | null>;
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

const EXPORT_PLATFORM: AnonymizedExportPlatform = {
  getPdfRenderer,
  renderDocxToPdf,
  isMacAppStore: IS_MAC_APP_STORE,
};

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
    setAnonymizationLoading,
    setAnonymizationError,
    setAnonymizationResult,
    setPromptsLoading,
    setPromptsError,
    setPrompts,
    setSelectedPrompt,
    setDeanonymizationInput,
    setDeanonymizationLoading,
    setDeanonymizationError,
    setDeanonymizationResult,
    setDeanonymizationMap,
    resetDocument,
  } = useAppStore();
  const [appVersion, setAppVersion] = useState("");
  const [exportNotice, setExportNotice] = useState<string | null>(null);
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
  const [excludedCategories, setExcludedCategoriesState] = useState<EntityCategory[]>(
    loadExcludedCategories,
  );
  const [batchItems, setBatchItems] = useState<BatchQueueItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [replacementMode, setReplacementMode] = useState(() => loadReplacementMode());
  const [profile, setProfile] = useState(() => loadProfile());
  const [maskFaces, setMaskFaces] = useState(() => loadMaskFaces());
  const [hotkeysEnabled, setHotkeysEnabled] = useState(() => loadHotkeysEnabled());
  const [rememberMaps, setRememberMaps] = useState(() => loadRememberMaps());
  const [rememberedMapsNote, setRememberedMapsNote] = useState<string | null>(null);
  // Remembered maps older than 30 days go away at every start.
  useEffect(() => {
    void removeExpiredMaps().catch(() => undefined);
  }, []);
  const deleteAllRememberedMaps = useCallback(async () => {
    const confirmed = await confirmSensitiveAction(
      texts.rememberedMaps.deleteConfirm,
      texts.rememberedMaps.deleteButton,
      texts.rememberedMaps.deleteConfirmButton,
    );
    if (!confirmed) {
      return;
    }
    try {
      setRememberedMapsNote(texts.rememberedMaps.deleted(await deleteRememberedMaps()));
    } catch {
      setRememberedMapsNote(texts.rememberedMaps.deleteFailed);
    }
  }, []);
  // "Jedna sprawa" in batch mode: all files share their tokens.
  const [batchSharedCase, setBatchSharedCase] = useState(false);
  // Map of the case being worked on in the window: every new document continues it.
  const [caseMap, setCaseMap] = useState<ReplacementMap | null>(null);
  const [lockedCaseMap, setLockedCaseMap] = useState<{ json: string; error: string | null } | null>(
    null,
  );
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

  // Applies what the user set up for every document: their own detection rules (Early Bird)
  // and the categories they never want anonymized.
  const applyUserSettingsToDocument = useCallback(
    async (
      client: ReturnType<typeof createAnonymizerApiClient>,
      response: DocumentProcessResponse,
    ): Promise<DocumentProcessResponse> => {
      const text = response.document.text;
      let entities = response.entities;
      let changed = false;
      const rules: CustomRegexRulePayload[] =
        productTier === "early_bird" ? enabledCustomRulePayloads(customRules) : [];
      if (rules.length > 0) {
        entities = (await client.analyze(text, rules)).entities;
        changed = true;
      }
      if (entities.some((entity) => excludedCategories.includes(entity.category))) {
        entities = rejectExcludedCategories(entities, excludedCategories);
        changed = true;
      }
      if (!changed) {
        return response;
      }
      const anonymized = await client.anonymizeApiEntities(text, entities);
      return {
        ...response,
        entities,
        anonymized_text: anonymized.anonymized_text,
        replacement_map: anonymized.replacement_map,
        offset_map: anonymized.offset_map ?? [],
      };
    },
    [customRules, excludedCategories, productTier],
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
    if (UPDATES_MANAGED_BY_STORE) {
      return;
    }
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

  const updateExcludedCategories = useCallback((categories: EntityCategory[]) => {
    setExcludedCategoriesState(categories);
    saveExcludedCategories(categories);
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

    const applyStatus = (event: EngineStatusEvent) => {
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
    };

    listenToEngineStatus(applyStatus)
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((error: unknown) => setEngineFailed(toUserMessage(error)));

    // The engine may have failed (or become ready) before this listener existed.
    getEngineStatus()
      .then(applyStatus)
      .catch((error: unknown) => {
        if (active) {
          setEngineFailed(toUserMessage(error));
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

      // Show progress at once: waiting for the engine to start (tens of seconds on a fresh
      // launch) looked like nothing happened and users dropped the file again.
      setProcessing("parsing");
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
      if (uiState.forceOcr) {
        timers.push(window.setTimeout(() => setProcessing("ocr"), 500));
        timers.push(window.setTimeout(() => setProcessing("detecting"), 1200));
      } else {
        timers.push(window.setTimeout(() => setProcessing("detecting"), 600));
      }

      try {
        const client = createAnonymizerApiClient(endpoint);
        // DOC and RTF are opened as DOCX (converted by Word or LibreOffice).
        const prepared = await prepareDocument(file, convertToDocx);
        let response = await applyUserSettingsToDocument(
          client,
          await client.processDocument(prepared.file, { forceOcr: uiState.forceOcr }),
        );
        if (prepared.converted) {
          response = {
            ...response,
            document: {
              ...response.document,
              notices: [...(response.document.notices ?? []), CONVERTED_NOTICE],
            },
          };
        }
        if (caseMap) {
          const inCase = await client.anonymizeApiEntities(
            response.document.text,
            response.entities,
            "pl",
            caseMap,
          );
          response = {
            ...response,
            anonymized_text: inCase.anonymized_text,
            replacement_map: inCase.replacement_map,
            offset_map: inCase.offset_map ?? [],
          };
          setCaseMap(inCase.replacement_map);
        }
        setProcessedDocument(response, prepared.file);
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
      applyUserSettingsToDocument,
      caseMap,
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

  // Explorer context menu (Poufnik → Anonimizuj / OCR / Markdown / Przywróć dane / Usuń
  // metadane). Open to everyone, with or without an account. Runs in the background with the
  // user's settings; each finished file is reported by a notification. It waits only until
  // the saved session is read, so an account's custom rules apply.
  const shellQueueRunning = useRef(false);
  const runShellQueue = useCallback(async () => {
    if (shellQueueRunning.current || authState.status === "loading") {
      return;
    }
    shellQueueRunning.current = true;
    try {
      for (;;) {
        const requests = await takeShellActions();
        if (requests.length === 0) {
          break;
        }
        let endpoint: EngineEndpoint;
        try {
          endpoint = await waitForEngine();
        } catch (error) {
          await notify(texts.shellActions.title, toUserMessage(error));
          continue;
        }
        const deps = {
          client: createAnonymizerApiClient(endpoint),
          readDocument: async (path: string) => {
            const file = await fileFromPath(path);
            if (file.size > MAX_UPLOAD_BYTES) {
              throw new Error(texts.errors.payloadTooLarge);
            }
            return (await prepareDocument(file, convertToDocx)).file;
          },
          readText: (path: string) => readTextFile(path),
          writeFile: writeOutputFile,
          exists: (path: string) => pathExists(path),
          copyText,
          applyUserSettings: applyUserSettingsToDocument,
          exportPlatform: EXPORT_PLATFORM,
          rememberMap: rememberReplacementMap,
          findMaps: findReplacementMaps,
        };
        for (const request of requests) {
          for (const path of request.paths) {
            const name = filenameOf(path);
            let outcome: ShellActionOutcome;
            // Restore and metadata check their own file types; the rest need a document.
            const ownTypes = request.action === "restore" || request.action === "metadata";
            if (!ownTypes && !isSupportedDocumentName(name)) {
              outcome = { ok: false, reason: "unsupported" };
            } else {
              try {
                outcome = await runShellAction(request.action, path, deps);
              } catch (error) {
                outcome = { ok: false, reason: "error", message: toUserMessage(error) };
              }
            }
            await notify(texts.shellActions.title, shellOutcomeMessage(request.action, name, outcome));
          }
        }
      }
    } finally {
      shellQueueRunning.current = false;
      await finishShellActions().catch(() => undefined);
    }
  }, [applyUserSettingsToDocument, authState.status]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let active = true;
    void runShellQueue();
    listenToShellActions(() => void runShellQueue())
      .then((dispose) => {
        if (active) {
          unlisten = dispose;
        } else {
          dispose();
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [runShellQueue]);

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
      // A second run (a retried or an added file) continues the case of the files already
      // done: their maps grow one from another, so the largest one holds them all.
      let sharedMap: ReplacementMap | null = batchSharedCase
        ? batchItems.reduce<ReplacementMap | null>(
            (largest, item) =>
              item.status === "done" &&
              item.replacementMap &&
              item.replacementMap.entries.length > (largest?.entries.length ?? -1)
                ? item.replacementMap
                : largest,
            null,
          )
        : null;
      await processBatchQueue(
        batchItems,
        async (item): Promise<BatchProcessSuccess> => {
          const prepared = await prepareDocument(item.file, convertToDocx);
          let processed = await applyUserSettingsToDocument(
            client,
            await client.processDocument(prepared.file, { forceOcr: uiState.forceOcr }),
          );
          if (batchSharedCase) {
            const inCase = await client.anonymizeApiEntities(
              processed.document.text,
              processed.entities,
              "pl",
              sharedMap,
            );
            sharedMap = inCase.replacement_map;
            processed = {
              ...processed,
              anonymized_text: inCase.anonymized_text,
              replacement_map: inCase.replacement_map,
              offset_map: inCase.offset_map ?? [],
            };
          }
          rememberMapQuietly(processed.replacement_map, item.file.name);
          return {
            document: processed.document,
            anonymizedText: processed.anonymized_text,
            replacementMap: processed.replacement_map,
            entityCount: processed.entities.length,
          };
        },
        patchBatchItem,
        // One case: files one after another, so the map grows in a fixed order.
        batchSharedCase ? 1 : undefined,
      );
      setBatchMessage(texts.batch.done);
    } catch (error) {
      setBatchError(toUserMessage(error));
    } finally {
      setBatchRunning(false);
    }
  }, [
    applyUserSettingsToDocument,
    batchItems,
    batchRunning,
    batchSharedCase,
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
      const result = await client.anonymize(document.text, entities, "pl", caseMap);
      if (caseMap) {
        setCaseMap(result.replacement_map);
      }
      setAnonymizationResult(
        result.anonymized_text,
        result.replacement_map,
        result.offset_map ?? [],
      );
      rememberMapQuietly(result.replacement_map, uiState.selectedFileName);
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
            window.setTimeout(
              () => setHistoryMessage((current) => (current === texts.history.saved ? null : current)),
              5000,
            );
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
    uiState.selectedFileName,
    caseMap,
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

  const saveReplacementMap = useCallback(
    async (password: string | null) => {
      if (!anonymization.replacementMap) {
        return;
      }
      const name = poufnikFileName(
        uiState.selectedFileName,
        "json",
        "map",
        anonymization.replacementMap,
      );
      if (password) {
        // Encrypted: readable only with the password, so no warning is needed.
        await saveJsonFile(
          name.replace(/\.json$/, "_zaszyfrowana.json"),
          await encryptMap(anonymization.replacementMap, password),
        );
        return;
      }
      const confirmed = await confirmSensitiveAction(
        texts.generation.mapWarning,
        texts.generation.mapWarningTitle,
      );
      if (!confirmed) {
        return;
      }
      await saveJsonFile(name, JSON.stringify(anonymization.replacementMap, null, 2));
    },
    [anonymization.replacementMap, uiState.selectedFileName],
  );

  // Builds the exported file; returns null when there is nothing to export (the error is
  // already shown). Shared by the export buttons and the E2E hook.
  const buildExportFile = useCallback(
    async (format: ExportFormat): Promise<Blob | null> => {
      if (!anonymization.anonymizedText) {
        return null;
      }
      const endpoint = await resolveEndpoint();
      if (!endpoint) {
        setAnonymizationError(texts.errors.noEngine);
        return null;
      }
      setExportNotice(null);
      const { blob, notice } = await buildAnonymizedExport(
        createAnonymizerApiClient(endpoint),
        {
          document,
          sourceFile: uiState.selectedFile,
          anonymizedText: anonymization.anonymizedText,
          offsetMap: anonymization.offsetMap,
        },
        format,
        EXPORT_PLATFORM,
      );
      if (notice) {
        setExportNotice(notice);
      }
      return blob;
    },
    [
      anonymization.anonymizedText,
      anonymization.offsetMap,
      document,
      resolveEndpoint,
      setAnonymizationError,
      uiState.selectedFile,
    ],
  );

  const exportDocument = useCallback(
    async (format: ExportFormat) => {
      try {
        const blob = await buildExportFile(format);
        if (blob) {
          await saveBinaryFile(
            poufnikFileName(uiState.selectedFileName, format, "result", anonymization.replacementMap),
            blob,
            format,
          );
        }
      } catch (error) {
        setAnonymizationError(toUserMessage(error));
      }
    },
    [buildExportFile, anonymization.replacementMap, setAnonymizationError, uiState.selectedFileName],
  );

  // "Dokument" tab of the result: the original and the anonymized file drawn 1:1. The
  // anonymized file is built exactly as "Eksportuj" saves it.
  const resultPreviewKind = previewKind(document?.format);
  const loadAnonymizedPreview = useCallback(async (): Promise<PreviewFile | null> => {
    if (!anonymization.anonymizedText || !resultPreviewKind) {
      return null;
    }
    const endpoint = await resolveEndpoint();
    if (!endpoint) {
      throw new Error(texts.errors.noEngine);
    }
    const client = createAnonymizerApiClient(endpoint);
    const source = {
      document,
      sourceFile: uiState.selectedFile,
      anonymizedText: anonymization.anonymizedText,
      offsetMap: anonymization.offsetMap,
    };
    if (resultPreviewKind === "image") {
      // A picture the engine cannot redact in place comes back as a simplified PDF.
      const { blob, notice } = await buildOwnFormatExport(client, source);
      return { blob, kind: blob.type === "application/pdf" ? "pdf" : "image", notice };
    }
    if (resultPreviewKind === "office") {
      // The file "Eksportuj" saves, in its own format; Office or LibreOffice draws it. When
      // the engine could not keep the format, the simplified DOCX is drawn by docx-preview.
      const { blob, notice, extension } = await buildOwnFormatExport(client, source);
      return extension === "docx"
        ? { blob, kind: "docx", notice }
        : { blob, kind: "office", notice, format: extension };
    }
    const format: ExportFormat = resultPreviewKind === "docx" ? "docx" : "pdf";
    const { blob, notice } = await buildAnonymizedExport(client, source, format, EXPORT_PLATFORM);
    return { blob, kind: format, notice };
  }, [
    anonymization.anonymizedText,
    anonymization.offsetMap,
    document,
    resolveEndpoint,
    resultPreviewKind,
    uiState.selectedFile,
  ]);
  const originalKind = originalPreviewKind(uiState.selectedFile, document?.format);
  const documentPreview =
    resultPreviewKind && anonymization.anonymizedText ? (
      <DocumentPreviewPair
        original={
          uiState.selectedFile && originalKind
            ? { file: uiState.selectedFile, kind: originalKind, format: document?.format }
            : null
        }
        loadAnonymized={loadAnonymizedPreview}
        version={anonymization.anonymizedText}
        shownNotice={exportNotice}
      />
    ) : undefined;

  // Report for the case file: what was anonymized and how, without any value from the text.
  const saveReport = useCallback(async () => {
    if (!anonymization.anonymizedText || !anonymization.replacementMap || !document) {
      return;
    }
    try {
      const endpoint = await resolveEndpoint();
      if (!endpoint) {
        setAnonymizationError(texts.errors.noEngine);
        return;
      }
      const extension = document.format === "pdf" ? "pdf" : document.format;
      const request = buildReportRequest({
        documentName: poufnikFileName(
          uiState.selectedFileName ?? document.filename,
          extension,
          "result",
          anonymization.replacementMap,
        ),
        documentFormat: document.format,
        pageCount: document.page_count,
        sourceSha256: uiState.selectedFile ? await sha256Hex(uiState.selectedFile) : null,
        appVersion,
        offsetMap: anonymization.offsetMap,
        entities,
        excludedCategories,
        notices: [
          ...(document.notices ?? [])
            .map((code) => texts.generation.notices[code])
            .filter((notice): notice is string => Boolean(notice)),
          ...((document.unread_pages ?? []).length > 0
            ? [texts.generation.unreadPages(document.unread_pages ?? [])]
            : []),
        ],
        mode: anonymization.offsetMap.some((entry) => entry.label)
          ? texts.replacementMode.reportMode
          : undefined,
      });
      const blob = await createAnonymizerApiClient(endpoint).buildReport(request);
      const stem = request.document_name.replace(/\.[^.]+$/, "");
      const saved = await saveBinaryFile(`${stem}_raport.pdf`, blob, "pdf");
      if (saved) {
        setExportNotice(texts.generation.reportSaved(saved));
      }
    } catch (error) {
      setAnonymizationError(toUserMessage(error));
    }
  }, [
    anonymization.anonymizedText,
    anonymization.offsetMap,
    anonymization.replacementMap,
    appVersion,
    document,
    entities,
    excludedCategories,
    resolveEndpoint,
    setAnonymizationError,
    uiState.selectedFile,
    uiState.selectedFileName,
  ]);

  // Spreadsheets, presentations, OpenDocument files and pictures, saved in their own format.
  const exportOwnFormat = useCallback(async () => {
    if (!anonymization.anonymizedText) {
      return;
    }
    try {
      const endpoint = await resolveEndpoint();
      if (!endpoint) {
        setAnonymizationError(texts.errors.noEngine);
        return;
      }
      setExportNotice(null);
      const { blob, notice, extension } = await buildOwnFormatExport(
        createAnonymizerApiClient(endpoint),
        {
          document,
          sourceFile: uiState.selectedFile,
          anonymizedText: anonymization.anonymizedText,
          offsetMap: anonymization.offsetMap,
        },
      );
      if (notice) {
        setExportNotice(notice);
      }
      await saveBinaryFile(
        poufnikFileName(uiState.selectedFileName, extension, "result", anonymization.replacementMap),
        blob,
        extension,
      );
    } catch (error) {
      setAnonymizationError(toUserMessage(error));
    }
  }, [
    anonymization.anonymizedText,
    anonymization.offsetMap,
    anonymization.replacementMap,
    document,
    resolveEndpoint,
    setAnonymizationError,
    uiState.selectedFile,
    uiState.selectedFileName,
  ]);

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
      // The engine's own (English) warnings become one plain-Polish note.
      const warning = restoreWarningMessage(
        deanonymization.input,
        replacementMap,
        result.warnings ?? [],
        "text",
      );
      setDeanonymizationResult(result.original_text, warning ? [warning] : []);
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

  // "Przywróć dane w pliku": a DOCX/XLSX/PDF/TXT/MD file that came back from an AI chat gets the
  // original data back in its own format. The map is picked automatically (mapLinking.ts):
  // the one loaded by the user, then maps linked by file name, then by tokens; when several
  // fit with different data the user chooses.
  const [fileRestore, setFileRestore] = useState<FileRestoreState>(IDLE_FILE_RESTORE);
  const pendingFileRestore = useRef<{ file: File; text: string; endpoint: EngineEndpoint } | null>(
    null,
  );

  const finishFileRestore = useCallback(async (candidate: MapCandidate) => {
    const pending = pendingFileRestore.current;
    pendingFileRestore.current = null;
    if (!pending) {
      return;
    }
    setFileRestore({ status: "loading", message: null, choices: [] });
    try {
      const { file, text, endpoint } = pending;
      const { contents, notice } = await restoreFileContents(createAnonymizerApiClient(endpoint), {
        name: file.name,
        file,
        text,
        map: candidate.map,
      });
      const blob =
        typeof contents === "string"
          ? new Blob([contents], { type: "text/plain;charset=utf-8" })
          : contents;
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "txt";
      const saved = await saveBinaryFile(restoredFileName(file.name), blob, extension);
      setFileRestore({
        status: saved ? "done" : "idle",
        message: saved
          ? [texts.deanonymization.fileSaved(saved), notice].filter(Boolean).join(" ")
          : texts.deanonymization.fileCancelled,
        choices: [],
      });
    } catch (error) {
      setFileRestore({ status: "error", message: toUserMessage(error), choices: [] });
    }
  }, []);

  const restorePickedFile = useCallback(async (picked: { file: File; path: string | null }) => {
    const { file, path } = picked;
    const fail = (message: string) => setFileRestore({ status: "error", message, choices: [] });
    if (!isRestorableFileName(file.name)) {
      fail(texts.deanonymization.fileUnsupported);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      fail(texts.errors.payloadTooLarge);
      return;
    }
    const endpoint = await resolveEndpoint();
    if (!endpoint) {
      fail(texts.errors.noEngine);
      return;
    }
    setFileRestore({ status: "loading", message: null, choices: [] });
    try {
      const text = await restorableText(createAnonymizerApiClient(endpoint), file);
      const loaded = deanonymization.replacementMap;
      const candidates: MapCandidate[] = [];
      if (loaded) {
        candidates.push({
          map: loaded,
          sourceName: deanonymization.mapSource === "session" ? uiState.selectedFileName : null,
          outputName: null,
          mapFileName: null,
          savedAt: null,
        });
      }
      candidates.push(...(await findReplacementMaps(path).catch(() => [] as MapCandidate[])));
      // A map the user loaded on purpose is used whenever it knows the file's tokens.
      const choice =
        deanonymization.mapSource === "file" && loaded
          ? chooseReplacementMap(file.name, text, candidates.slice(0, 1))
          : chooseReplacementMap(file.name, text, candidates);
      pendingFileRestore.current = { file, text, endpoint };
      if (choice.kind === "found") {
        await finishFileRestore(choice.candidate);
      } else if (choice.kind === "ambiguous") {
        setFileRestore({ status: "choose", message: null, choices: choice.candidates });
      } else {
        pendingFileRestore.current = null;
        fail(texts.deanonymization.fileNoMap);
      }
    } catch (error) {
      pendingFileRestore.current = null;
      fail(toUserMessage(error));
    }
  }, [
    deanonymization.mapSource,
    deanonymization.replacementMap,
    finishFileRestore,
    resolveEndpoint,
    uiState.selectedFileName,
  ]);

  const restoreFileFromAi = useCallback(async () => {
    let picked: { file: File; path: string | null } | null = null;
    try {
      picked = await pickRestorableFile();
    } catch {
      picked = await pickBrowserRestorableFile().catch(() => null);
    }
    if (picked) {
      await restorePickedFile(picked);
    }
  }, [restorePickedFile]);

  // A file dropped on the "Przywracanie" screen: the browser gives no path, so only maps
  // known to the app are searched.
  const restoreDroppedFile = useCallback(
    (file: File) => void restorePickedFile({ file, path: null }),
    [restorePickedFile],
  );

  const cancelFileRestoreChoice = useCallback(() => {
    pendingFileRestore.current = null;
    setFileRestore(IDLE_FILE_RESTORE);
  }, []);

  // An encrypted map waits here for its password (mapCrypto.ts).
  const [lockedMap, setLockedMap] = useState<{ json: string; error: string | null } | null>(
    null,
  );
  const loadReplacementMap = useCallback(async () => {
    try {
      const json = await pickReplacementMapFile();
      if (!json) {
        return;
      }
      if (isEncryptedMap(json)) {
        setLockedMap({ json, error: null });
        return;
      }
      setLockedMap(null);
      setDeanonymizationMap(parseReplacementMap(json), "file");
    } catch (error) {
      setDeanonymizationError(toUserMessage(error));
    }
  }, [setDeanonymizationError, setDeanonymizationMap]);

  const unlockMap = useCallback(
    async (password: string) => {
      if (!lockedMap) {
        return;
      }
      try {
        setDeanonymizationMap(await decryptMap(lockedMap.json, password), "file");
        setLockedMap(null);
      } catch (error) {
        setLockedMap({ json: lockedMap.json, error: toUserMessage(error) });
      }
    },
    [lockedMap, setDeanonymizationMap],
  );

  // A case: the map of earlier documents is continued by this and every next document.
  const applyCaseMap = useCallback(
    async (map: ReplacementMap) => {
      setCaseMap(map);
      setLockedCaseMap(null);
      if (!document || !anonymization.anonymizedText) {
        return;
      }
      const endpoint = await resolveEndpoint();
      if (!endpoint) {
        setAnonymizationError(texts.errors.noEngine);
        return;
      }
      try {
        const result = await createAnonymizerApiClient(endpoint).anonymize(
          document.text,
          entities,
          "pl",
          map,
        );
        setAnonymizationResult(result.anonymized_text, result.replacement_map, result.offset_map ?? []);
        setCaseMap(result.replacement_map);
        rememberMapQuietly(result.replacement_map, uiState.selectedFileName);
      } catch (error) {
        setAnonymizationError(toUserMessage(error));
      }
    },
    [
      anonymization.anonymizedText,
      document,
      entities,
      resolveEndpoint,
      setAnonymizationError,
      setAnonymizationResult,
      uiState.selectedFileName,
    ],
  );

  const loadCaseMap = useCallback(async () => {
    try {
      const json = await pickReplacementMapFile();
      if (!json) {
        return;
      }
      if (isEncryptedMap(json)) {
        setLockedCaseMap({ json, error: null });
        return;
      }
      await applyCaseMap(parseReplacementMap(json));
    } catch (error) {
      setAnonymizationError(toUserMessage(error));
    }
  }, [setAnonymizationError, applyCaseMap]);

  const unlockCaseMap = useCallback(
    async (password: string) => {
      if (!lockedCaseMap) {
        return;
      }
      try {
        await applyCaseMap(await decryptMap(lockedCaseMap.json, password));
      } catch (error) {
        setLockedCaseMap({ json: lockedCaseMap.json, error: toUserMessage(error) });
      }
    },
    [lockedCaseMap, applyCaseMap],
  );

  const caseControls = (
    <div className="case-controls">
      <h4>{texts.generation.caseTitle}</h4>
      <p className="muted">
        {caseMap ? texts.generation.caseActive(caseMap.entries.length) : texts.generation.caseLead}
      </p>
      <div className="toolbar">
        {caseMap ? (
          <button className="ghost-button ghost-button--compact" type="button" onClick={() => setCaseMap(null)}>
            {texts.generation.caseEnd}
          </button>
        ) : (
          <button
            className="secondary-button secondary-button--compact"
            type="button"
            onClick={() => void loadCaseMap()}
          >
            {texts.generation.caseLoad}
          </button>
        )}
      </div>
      {lockedCaseMap ? (
        <MapPasswordForm error={lockedCaseMap.error} onUnlock={(password) => void unlockCaseMap(password)} />
      ) : null}
    </div>
  );

  // Ctrl+Alt+Shift+P / R from any program: anonymize or restore the clipboard.
  const runClipboardAction = useCallback(
    async (action: "anonymize" | "restore") => {
      try {
        const endpoint = await waitForEngine();
        const deps = {
          client: createAnonymizerApiClient(endpoint),
          readText: readClipboardText,
          writeText: copyText,
          excludedCategories,
          customRules:
            productTier === "early_bird" ? enabledCustomRulePayloads(customRules) : [],
          rememberMap: rememberReplacementMap,
          findMaps: () => findReplacementMaps(null),
        };
        const outcome =
          action === "anonymize" ? await anonymizeClipboard(deps) : await restoreClipboard(deps);
        const message = outcome.ok
          ? action === "anonymize"
            ? texts.hotkeys.anonymized(outcome.replaced)
            : [texts.hotkeys.restored, outcome.warning].filter(Boolean).join(" ")
          : {
              empty: texts.hotkeys.empty,
              nothing_found: texts.hotkeys.nothingFound,
              no_map: texts.hotkeys.noMap,
              ambiguous_map: texts.hotkeys.ambiguousMap,
            }[outcome.reason];
        await notify(texts.shellActions.title, message);
      } catch (error) {
        await notify(texts.shellActions.title, texts.hotkeys.failed(toUserMessage(error)));
      }
    },
    [customRules, excludedCategories, productTier],
  );

  // The shortcuts are registered once; a key press runs the current settings through the ref.
  const clipboardActionRef = useRef(runClipboardAction);
  clipboardActionRef.current = runClipboardAction;
  useEffect(() => {
    if (!hotkeysEnabled) {
      return;
    }
    return registerClipboardShortcuts({
      onAnonymize: () => void clipboardActionRef.current("anonymize"),
      onRestore: () => void clipboardActionRef.current("restore"),
    });
  }, [hotkeysEnabled]);

  const fileRestorePanel = (
    <FileRestorePanel
      state={fileRestore}
      disabled={uiState.engineStatus !== "ready"}
      onChooseFile={() => void restoreFileFromAi()}
      onChooseMap={(candidate) => void finishFileRestore(candidate)}
      onCancelChoice={cancelFileRestoreChoice}
      onLoadMap={() => void loadReplacementMap()}
      mapLoaded={deanonymization.mapSource === "file"}
      lockedMap={lockedMap ? { error: lockedMap.error } : null}
      onUnlockMap={(password) => void unlockMap(password)}
    />
  );

  const fileRestoreTool = (
    <FileRestorePanel
      variant="tool"
      state={fileRestore}
      disabled={uiState.engineStatus !== "ready"}
      onChooseFile={() => void restoreFileFromAi()}
      onDropFile={restoreDroppedFile}
      onChooseMap={(candidate) => void finishFileRestore(candidate)}
      onCancelChoice={cancelFileRestoreChoice}
      onLoadMap={() => void loadReplacementMap()}
      mapLoaded={deanonymization.mapSource === "file"}
      lockedMap={lockedMap ? { error: lockedMap.error } : null}
      onUnlockMap={(password) => void unlockMap(password)}
    />
  );

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

  const loginWithBrowser = useCallback(
    async (intent: "login" | "register" = "login") => {
      setBrowserLoginLoading(true);
      setAuthError(null);
      try {
        const response = await loginViaBrowser({ intent });
        const session = await verifyAccountToken(response.access_token);
        await rememberAuthenticatedSession(session);
      } catch (error) {
        setAuthError(authErrorMessage(error));
      } finally {
        setBrowserLoginLoading(false);
      }
    },
    [rememberAuthenticatedSession, verifyAccountToken],
  );

  const logout = useCallback(async () => {
    setCaseMap(null); // the next person at this computer does not continue someone's case
    await clearStoredAuthToken();
    saveStoredBasicChoice(true);
    setAuthError(null);
    setAuthState({ status: "basic", message: null });
  }, []);

  // Rejestracja idzie tym samym flow co logowanie przez przeglądarkę (loopback + PKCE),
  // tylko lądując na /register zamiast /login - serwer i tak koncowo odsyla ten sam kod
  // po zweryfikowaniu e-maila, wiec appka konczy zalogowana bez dodatkowego kroku.
  const openRegistration = useCallback(() => {
    void loginWithBrowser("register");
  }, [loginWithBrowser]);

  const openAccountDeletion = useCallback(() => {
    void openExternalUrl(getAccountDeletionUrl()).catch(() => {
      // Bez przeglądarki strona nadal jest dostępna pod adresem z opisu w Ustawieniach.
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
      exportFile: async (format: ExportFormat) => {
        const blob = await buildExportFile(format);
        if (!blob) {
          return null;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte);
        });
        return btoa(binary);
      },
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
  }, [
    batchItems,
    buildExportFile,
    processFile,
    productTier,
    restoreDocumentSession,
    setHistoryEnabled,
  ]);

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
              // With a document open, "Import" starts the next one, like "Nowy dokument"
              // (it did nothing visible: the result stayed on screen).
              onClick={hasDocument ? startNewDocument : () => setScreen("flow")}
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
            <button
              className={navItemClass(screen === "restore", false)}
              type="button"
              onClick={() => setScreen("restore")}
            >
              <span>{texts.nav.restore}</span>
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
                  onClick={() => setScreen("settings")}
                >
                  {texts.sidebar.login}
                </button>
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

          {caseMap ? (
            <div className="case-banner" role="status">
              <span>{texts.generation.caseBanner(caseMap.entries.length)}</span>
              <button className="ghost-button ghost-button--compact" type="button" onClick={() => setCaseMap(null)}>
                {texts.generation.caseEnd}
              </button>
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
                  anonymization={anonymization}
                  prompts={prompts}
                  deanonymization={deanonymization}
                  fileRestore={fileRestorePanel}
                  documentPreview={documentPreview}
                  caseControls={caseControls}
                  onSaveReport={() => void saveReport()}
                  processingStatus={uiState.processingStatus}
                  processingError={uiState.processingError}
                  view={workspaceView}
                  onViewChange={setWorkspaceView}
                  onRedetect={redetect}
                  onNewDocument={startNewDocument}
                  onAnonymize={anonymizeDocument}
                  onCopyDocument={copyAnonymizedDocument}
                  onSaveMap={saveReplacementMap}
                  onExport={exportDocument}
                  ownFormat={ownExportFormat(document)}
                  onExportOwnFormat={() => void exportOwnFormat()}
                  exportNotice={exportNotice}
                  documentNotices={document?.notices ?? []}
                  unreadPages={document?.unread_pages ?? []}
                  onLoadPrompts={loadPrompts}
                  onSelectPrompt={setSelectedPrompt}
                  onCopyPrompt={copyPrompt}
                  onDeanonymizationInput={setDeanonymizationInput}
                  onDeanonymize={deanonymizeText}
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

            {screen === "restore" ? (
              <section className="screen screen--tool" key="restore" aria-labelledby="restore-title">
                <h2 className="screen-title" id="restore-title">
                  {texts.deanonymization.toolTitle}
                </h2>
                <p className="screen-lead">{texts.deanonymization.fileLead}</p>
                <div className="screen__body">
                  {fileRestoreTool}
                  <DeanonymizePanel
                    deanonymization={deanonymization}
                    onInputChange={setDeanonymizationInput}
                    onRestore={deanonymizeText}
                    onCopyResult={copyDeanonymizedResult}
                  />
                </div>
              </section>
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
                      <div className="screen__body">
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
                                <div className="history-item__main">
                                  <span className="history-item__name" title={entry.filename}>
                                    {entry.filename}
                                  </span>
                                  <span className="history-item__meta">
                                    {formatHistoryDate(entry.createdAt)} ·{" "}
                                    {entry.documentFormat.toUpperCase()} ·{" "}
                                    {texts.history.entitiesReplaced(
                                      entry.acceptedEntityCount,
                                      entry.entityCount,
                                    )}
                                  </span>
                                </div>
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
                    sharedCase={batchSharedCase}
                    onSharedCaseChange={setBatchSharedCase}
                    onDropFiles={appendBatchFiles}
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
                  browserLoginLoading={browserLoginLoading}
                  onLogin={login}
                  onLoginBrowser={() => void loginWithBrowser("login")}
                  onRegister={openRegistration}
                  onLogout={() => void logout()}
                  onDeleteAccount={openAccountDeletion}
                />
                <ReplacementModeSettings
                  mode={replacementMode}
                  onChange={(mode) => {
                    saveReplacementMode(mode);
                    setReplacementMode(mode);
                  }}
                  profile={profile}
                  onProfileChange={(next) => {
                    saveProfile(next);
                    setProfile(next);
                  }}
                  maskFaces={maskFaces}
                  onMaskFacesChange={(enabled) => {
                    saveMaskFaces(enabled);
                    setMaskFaces(enabled);
                  }}
                />
                <section className="settings-section">
                  <h3>{texts.hotkeys.heading}</h3>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={hotkeysEnabled}
                      onChange={(event) => {
                        saveHotkeysEnabled(event.target.checked);
                        setHotkeysEnabled(event.target.checked);
                      }}
                    />
                    <span>
                      <strong>{texts.hotkeys.enabled}</strong>
                      <span className="checkbox-row__note">{texts.hotkeys.note}</span>
                    </span>
                  </label>
                </section>
                <section className="settings-section">
                  <h3>{texts.rememberedMaps.heading}</h3>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={rememberMaps}
                      onChange={(event) => {
                        saveRememberMaps(event.target.checked);
                        setRememberMaps(event.target.checked);
                      }}
                    />
                    <span>
                      <strong>{texts.rememberedMaps.enabled}</strong>
                      <span className="checkbox-row__note">
                        {texts.rememberedMaps.note(!/Mac/i.test(navigator.userAgent))}
                      </span>
                    </span>
                  </label>
                  <div className="toolbar">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void deleteAllRememberedMaps()}
                    >
                      {texts.rememberedMaps.deleteButton}
                    </button>
                  </div>
                  {rememberedMapsNote ? (
                    <p className="status-note" role="status">
                      {rememberedMapsNote}
                    </p>
                  ) : null}
                </section>
                <ExcludedCategoriesSettings
                  excluded={excludedCategories}
                  onChange={updateExcludedCategories}
                />
                {IS_MACOS && !IS_MAC_APP_STORE ? <FinderMenuSettings /> : null}
                <section className="settings-section">
                  <h3>{texts.updates.sectionTitle}</h3>
                  {UPDATES_MANAGED_BY_STORE ? (
                    <p className="muted">
                      {IS_MAC_APP_STORE ? texts.updates.managedByAppStore : texts.updates.managedByStore}
                    </p>
                  ) : (
                    <>
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
                      {updateMessage ? (
                        <p className="status-note status-note--success">{updateMessage}</p>
                      ) : null}
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
                    </>
                  )}
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

/**
 * Remembers the map of a document anonymized in the window, so "Przywróć dane w pliku" and the
 * context menu find it later. Never interrupts anonymization (e.g. outside the desktop app).
 */
function rememberMapQuietly(map: ReplacementMap, sourceName: string | null): void {
  const outputName = sourceName
    ? poufnikFileName(sourceName, sourceName.split(".").pop() ?? "pdf", "result", map)
    : null;
  void rememberReplacementMap(map, { sourceName, outputName }).catch(() => undefined);
}

function shellOutcomeMessage(
  action: string,
  name: string,
  outcome: ShellActionOutcome,
): string {
  if (!outcome.ok) {
    if (outcome.reason === "no_map") {
      return texts.shellActions.noMap;
    }
    if (outcome.reason === "ambiguous_map") {
      return texts.shellActions.ambiguousMap;
    }
    if (outcome.reason === "unsupported") {
      return texts.shellActions.unsupported;
    }
    return texts.shellActions.failed(name, outcome.message ?? texts.errors.generic);
  }
  const output = filenameOf(outcome.outputPath);
  const message =
    action === "ocr"
      ? texts.shellActions.ocr(output)
      : action === "markdown"
        ? texts.shellActions.markdown(output)
        : action === "restore"
          ? texts.shellActions.restored(output)
          : action === "metadata"
            ? texts.shellActions.metadata(output)
            : texts.shellActions.anonymized(output);
  return outcome.notice ? `${message} ${outcome.notice}` : message;
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
