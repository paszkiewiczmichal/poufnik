import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Vite wczytuje desktop/.env.local także przy `vite build`. Lokalny adres
// serwera kont i klucz deweloperski wbudowane w paczkę rozjeżdżają logowanie
// (ERR_CONNECTION_REFUSED w przeglądarce, potem invalid_signature), więc
// build produkcyjny z takim adresem przerywamy głośno.
const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;

function assertNoLocalAccountsInBuild(mode: string) {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const baseUrl = env.VITE_POUFNIK_ACCOUNTS_BASE_URL ?? "";
  if (LOCAL_HOST.test(baseUrl) && !env.VITE_POUFNIK_ALLOW_LOCAL_ACCOUNTS) {
    throw new Error(
      `Build produkcyjny z lokalnym serwerem kont (${baseUrl}). ` +
        "Najpewniej to desktop/.env.local - przenieś go do .env.development.local " +
        "(ładowany tylko przez `npm run dev`) albo ustaw w powłoce " +
        "VITE_POUFNIK_ACCOUNTS_BASE_URL=https://account.lawtern.com oraz pusty " +
        "VITE_POUFNIK_ACCOUNTS_PUBLIC_KEY_PEM. Świadomy build z lokalnym " +
        "serwerem: VITE_POUFNIK_ALLOW_LOCAL_ACCOUNTS=1.",
    );
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    assertNoLocalAccountsInBuild(mode);
  }
  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
    test: {
      environment: "jsdom",
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      exclude: ["e2e/**", "src-tauri/**", "node_modules/**", "dist/**"],
      setupFiles: "./src/test/setup.ts",
    },
  };
});
