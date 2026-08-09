import os from "node:os";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Builder, By, Capabilities, until } from "selenium-webdriver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const desktopRoot = path.resolve(repoRoot, "desktop");
const engineRoot = path.resolve(repoRoot, "engine");
const fixturePath = path.resolve(repoRoot, "corpus", "e2e", "umowa-e2e.docx");

const isWindows = process.platform === "win32";
const appBinary = path.resolve(
  desktopRoot,
  "src-tauri",
  "target",
  "debug",
  isWindows ? "anonymizer-desktop.exe" : "anonymizer-desktop",
);

let driver;
let tauriDriver;
let shuttingDown = false;

describe("Anonymizer desktop E2E", () => {
  beforeAll(async () => {
    prepareE2eSidecarPlaceholders();
    await runChecked("uv", ["run", "python", "tools/generate_e2e_fixtures.py"], {
      cwd: engineRoot,
      stdio: "inherit",
    });
    // Nakładka e2e dodaje --remote-debugging-port=0 do argumentów WebView2: wry nadpisuje
    // argumenty przeglądarki programowo, więc msedgedriver nie może wstrzyknąć portu przez
    // WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS i bez tego sesja pada na DevToolsActivePort.
    // Produkcyjny build (bez nakładki) nie otwiera portu debugowania.
    await runChecked(
      "npm",
      [
        "run",
        "tauri",
        "--",
        "build",
        "--debug",
        "--no-bundle",
        "--config",
        "src-tauri/tauri.e2e.conf.json",
      ],
      {
        cwd: desktopRoot,
        stdio: "inherit",
        env: {
          ...process.env,
          VITE_ANONYMIZER_E2E: "1",
        },
      },
    );

    tauriDriver = spawn(resolveTauriDriver(), [], {
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        ANONYMIZER_ENGINE_CWD: engineRoot,
      },
    });
    tauriDriver.on("error", (error) => {
      throw error;
    });
    tauriDriver.on("exit", (code) => {
      if (!shuttingDown) {
        throw new Error(`tauri-driver exited unexpectedly with code ${code}`);
      }
    });
    await waitForTcpPort(4444, 30000);

    const capabilities = new Capabilities();
    capabilities.setBrowserName("wry");
    capabilities.set("tauri:options", { application: appBinary, webviewOptions: {} });
    driver = await new Builder()
      .withCapabilities(capabilities)
      .usingServer("http://127.0.0.1:4444/")
      .build();

    await waitForHook();
    await e2e("enableEarlyBird");
    await e2e("setHistoryEnabled", true);
    await waitForEngine();
    await dismissUpdateConsent();
  }, 900000);

  afterAll(async () => {
    shuttingDown = true;
    if (driver) {
      await driver.quit();
    }
    if (tauriDriver) {
      tauriDriver.kill();
    }
  });

  it("runs the core document flow in Basic without an account", async () => {
    await e2e("useBasicTier");
    await importDocument();
    const basicSnapshot = await e2e("snapshot");
    expect(basicSnapshot.productTier).to.equal("basic");
    await driver.wait(until.elementLocated(By.css("mark.highlight")), 60000);

    await clickButton("Przejdź do wyniku");
    const result = await waitForResultText();
    expect(result).to.include("[OSOBA_1]");
    expect(result).to.include("[PESEL_1]");

    await driver.wait(until.elementLocated(By.css(".prompt-preview")), 30000);
    await clickButton("Kopiuj prompt z dokumentem");
    const clipboard = await e2e("readClipboard");
    expect(clipboard).to.include("[OSOBA_1]");
    expect(clipboard).to.not.include("{{DOKUMENT}}");

    await clickButton("Przywróć dane");
    const textarea = await driver.findElement(By.css(".deanon-panel textarea"));
    await textarea.clear();
    await textarea.sendKeys("Odpowiedź LLM: [OSOBA_1] ma PESEL [PESEL_1].");
    await clickDeanonRestore();
    await driver.wait(until.elementLocated(By.css(".deanon-text")), 30000);
    const restored = await driver.findElement(By.css(".deanon-text")).getText();
    expect(restored).to.include("Jan Kowalski");
    expect(restored).to.include("44051401359");
  });

  it("imports DOCX, shows highlights, anonymizes, compares, copies prompt, and deanonymizes in Early Bird", async () => {
    await e2e("enableEarlyBird");
    await importDocument();
    await driver.wait(until.elementLocated(By.css("mark.highlight")), 60000);

    await clickButton("Przejdź do wyniku");
    const result = await waitForResultText();
    expect(result).to.include("[OSOBA_1]");
    expect(result).to.include("[PESEL_1]");
    await clickButton("Porównanie");
    await driver.wait(until.elementLocated(By.css(".comparison-view")), 30000);
    await driver.wait(until.elementLocated(By.css(".comparison-highlight")), 30000);

    await clickButton("Wynik");
    await driver.wait(until.elementLocated(By.css(".prompt-preview")), 30000);
    await clickButton("Kopiuj prompt z dokumentem");
    const clipboard = await e2e("readClipboard");
    expect(clipboard).to.include("[OSOBA_1]");
    expect(clipboard).to.include("[PESEL_1]");
    expect(clipboard).to.not.include("{{DOKUMENT}}");

    await clickButton("Przywróć dane");
    const textarea = await driver.findElement(By.css(".deanon-panel textarea"));
    await textarea.clear();
    await textarea.sendKeys("Odpowiedź LLM: [OSOBA_1] ma PESEL [PESEL_1].");
    await clickDeanonRestore();
    await driver.wait(until.elementLocated(By.css(".deanon-text")), 30000);
    const restored = await driver.findElement(By.css(".deanon-text")).getText();
    expect(restored).to.include("Jan Kowalski");
    expect(restored).to.include("44051401359");
  });

  it("keeps the original text when an entity is unchecked before anonymization", async () => {
    await importDocument();
    await e2e("rejectFirstEntityContaining", "Jan");
    await clickButton("Przejdź do wyniku");
    const result = await waitForResultText();
    expect(result).to.include("Jan Kowalski");
    expect(result).to.not.include("[OSOBA_1]");
  });

  it("adds a manual entity and includes its token in the anonymized result", async () => {
    await importDocument();
    await e2e("addManualEntityByText", "ABC-XYZ-77", "CUSTOM");
    await clickButton("Przejdź do wyniku");
    const result = await waitForResultText();
    expect(result).to.include("[DANE_1]");
    expect(result).to.not.include("ABC-XYZ-77");
  });

  it("saves and restores an Early Bird history entry", async () => {
    await e2e("enableEarlyBird");
    await e2e("setHistoryEnabled", true);
    await importDocument();
    await clickButton("Przejdź do wyniku");
    const result = await waitForResultText();
    expect(result).to.include("[OSOBA_1]");

    await importDocument();
    await e2e("openLatestHistoryEntry");
    const snapshot = await e2e("snapshot");
    expect(snapshot.anonymizedText).to.include("[OSOBA_1]");
    expect(snapshot.entityCount).to.be.greaterThan(0);
  });
});

async function importDocument() {
  await e2e("importDocument", fixturePath);
  await driver.wait(async () => {
    const snapshot = await e2e("snapshot");
    if (snapshot.processingError) {
      throw new Error(`Document import failed: ${snapshot.processingError}`);
    }
    return snapshot.entityCount > 0;
  }, 120000);
}

async function waitForHook() {
  await driver.wait(async () => {
    return driver.executeScript("return Boolean(window.__ANONYMIZER_E2E__)");
  }, 30000);
}

async function waitForEngine() {
  await driver.wait(async () => {
    const snapshot = await e2e("snapshot");
    if (snapshot.engineStatus === "failed") {
      throw new Error(`Engine failed: ${snapshot.engineError ?? "unknown error"}`);
    }
    return snapshot.engineStatus === "ready";
  }, 90000);
}

async function dismissUpdateConsent() {
  const buttons = await driver.findElements(
    By.xpath('//button[contains(normalize-space(.), "Nie sprawdzaj")]'),
  );
  if (buttons.length === 0) {
    return;
  }
  await driver.executeScript("arguments[0].click()", buttons[0]);
  await driver.wait(async () => {
    const remaining = await driver.findElements(
      By.xpath('//button[contains(normalize-space(.), "Nie sprawdzaj")]'),
    );
    return remaining.length === 0;
  }, 10000);
}

async function clickButton(text) {
  const escaped = text.replace(/"/g, '\\"');
  const button = await driver.wait(
    until.elementLocated(By.xpath(`//button[contains(normalize-space(.), "${escaped}")]`)),
    30000,
  );
  await clickInteractable(button);
}

async function clickDeanonRestore() {
  const button = await driver.wait(
    until.elementLocated(
      By.xpath(
        '//section[contains(@class, "deanon-panel")]//button[contains(normalize-space(.), "Przywróć dane")]',
      ),
    ),
    30000,
  );
  await clickInteractable(button);
}

async function clickInteractable(button) {
  await driver.wait(until.elementIsEnabled(button), 30000);
  // WebKitGTK (Linux) nie doscrollowuje do elementu przed kliknięciem i rzuca
  // ElementNotInteractable dla celów poza kadrem; WebView2 robi to samo z siebie.
  await driver.executeScript(
    'arguments[0].scrollIntoView({ block: "center", inline: "nearest" })',
    button,
  );
  await button.click();
}

async function waitForResultText() {
  await driver.wait(until.elementLocated(By.css(".result-text")), 30000);
  await driver.wait(async () => {
    const snapshot = await e2e("snapshot");
    return Boolean(snapshot.anonymizedText);
  }, 30000);
  const snapshot = await e2e("snapshot");
  return snapshot.anonymizedText;
}

async function e2e(method, ...args) {
  const result = await driver.executeAsyncScript(
    `
    const method = arguments[0];
    const args = Array.from(arguments).slice(1, -1);
    const done = arguments[arguments.length - 1];
    const hook = window.__ANONYMIZER_E2E__;
    if (!hook || typeof hook[method] !== "function") {
      done({ ok: false, error: "Missing E2E hook method: " + method });
      return;
    }
    Promise.resolve(hook[method](...args))
      .then((value) => done({ ok: true, value }))
      .catch((error) => done({ ok: false, error: String(error && error.message ? error.message : error) }));
    `,
    method,
    ...args,
  );
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}

async function waitForTcpPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isOpen = await new Promise((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (isOpen) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for TCP port ${port}`);
}

function resolveTauriDriver() {
  if (process.env.TAURI_DRIVER) {
    return process.env.TAURI_DRIVER;
  }
  return path.resolve(os.homedir(), ".cargo", "bin", isWindows ? "tauri-driver.exe" : "tauri-driver");
}

function prepareE2eSidecarPlaceholders() {
  const binariesDir = path.resolve(desktopRoot, "src-tauri", "binaries");
  fs.mkdirSync(path.join(binariesDir, "_internal"), { recursive: true });
  fs.mkdirSync(path.join(binariesDir, "tesseract"), { recursive: true });

  const placeholders = [
    {
      path: path.join(binariesDir, "anonymizer-engine-x86_64-unknown-linux-gnu"),
      contents: "#!/bin/sh\nexit 1\n",
      executable: true,
    },
    {
      path: path.join(binariesDir, "anonymizer-engine-x86_64-pc-windows-msvc.exe"),
      contents: "E2E sidecar placeholder\n",
      executable: false,
    },
  ];

  for (const placeholder of placeholders) {
    if (!fs.existsSync(placeholder.path)) {
      fs.writeFileSync(placeholder.path, placeholder.contents);
    }
    if (placeholder.executable && !isWindows) {
      fs.chmodSync(placeholder.path, 0o755);
    }
  }
}

function runChecked(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: isWindows,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with ${
              signal ? `signal ${signal}` : `status ${code}`
            }`,
          ),
        );
      }
    });
  });
}
