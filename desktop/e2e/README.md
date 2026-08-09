# Desktop E2E

Scenariusze WebDriver uruchamia `npm run test:e2e`. Test buduje aplikacje Tauri w trybie debug, startuje `tauri-driver`, przełącza aplikację w testowy stan Early Bird, importuje fixture DOCX i przechodzi przez anonimizacje, porównanie, prompt, reczna encje, historie oraz deanonimizacje.

W CI E2E dziala na Windows i Linux. Zgodnie z dokumentacja Tauri 2 bezposredni `tauri-driver` jest wspierany dla Windows/Linux; macOS nie ma natywnego WebDrivera dla WKWebView w tej sciezce, dlatego nie jest tu uruchamiany. Na self-hosted Ubuntu 26.04 wariant Linux jest pomijany, jeśli repozytorium pakietów nie udostępnia `webkit2gtk-driver`; wtedy obowiązkową ścieżką regresji pozostaje `poufnik-windows`.
