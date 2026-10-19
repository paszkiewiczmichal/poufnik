# Poufnik w Mac App Store

Wersja do Mac App Store to osobny kanał, tak jak wersja ze Sklepu Microsoft. Wydanie
z GitHuba (DMG z aktualizatorem, podpis Developer ID) zostaje bez zmian.

## Czym różni się wersja z App Store

| | DMG z GitHuba | Mac App Store |
|---|---|---|
| Aktualizacje | własny aktualizator | App Store |
| Piaskownica (App Sandbox) | nie | tak |
| PDF z dokumentu Worda | przez Worda (wygląd oryginału) | uproszczony układ + komunikat |
| Procesory | Apple Silicon i Intel | tylko Apple Silicon |
| Minimalny macOS | jak dotąd | 14 |

- **PDF przez Worda** w piaskownicy jest niemożliwy: aplikacja nie może sterować Wordem
  (Apple Events) ani uruchamiać LibreOffice, a Word – sam w piaskownicy – i tak nie otworzy
  pliku tymczasowego Poufnika. Wyjątek `temporary-exception.apple-events` nie rozwiązałby
  tego drugiego problemu, a recenzja Apple przepuszcza go rzadko. Eksport DOCX zachowuje
  wygląd oryginału; PDF z niego zrobi użytkownik w Wordzie.
- **Tylko Apple Silicon**: silnik (PyInstaller) nie jest binarką uniwersalną, a App Store
  przyjmuje jedną paczkę na wersję. Użytkownicy Maców z Intelem korzystają z DMG.

## Jak to jest zbudowane

- Frontend: `VITE_POUFNIK_DISTRIBUTION=mas` → kanał `poufnik-channel-mas`
  (`desktop/src/tauri/updater.ts`); bez aktualizatora, w Ustawieniach „Aktualizacje tej
  wersji dostarcza App Store.”
- Rust: funkcja `mas` (`desktop/src-tauri/Cargo.toml`) – bez wtyczki aktualizatora,
  `pdf_render.rs` nie szuka Worda ani LibreOffice.
- Konfiguracja Tauri: `desktop/src-tauri/tauri.mas.conf.json` (bez artefaktów aktualizatora,
  kategoria Business, macOS 14, CSP bez adresu aktualizacji).
- Uprawnienia: `Entitlements.mas.plist` (aplikacja: piaskownica, sieć klient/serwer –
  silnik i logowanie przez przeglądarkę na 127.0.0.1, pliki wybrane przez użytkownika)
  i `Entitlements.mas.inherit.plist` (silnik i Tesseract: piaskownica + `inherit`; Apple
  nie pozwala na nic więcej przy `inherit`, a bez hardened runtime nic więcej nie trzeba).
- `desktop/scripts/package_mas.py`: kopiuje aplikację, usuwa z Info.plist opis Apple
  Events, ustawia `ITSAppUsesNonExemptEncryption = false` (tylko HTTPS – bez pytań
  o eksport szyfrowania), dokłada profil, podpisuje od środka (biblioteki, potem
  silnik i Tesseract, na końcu aplikację) i składa `.pkg`.
- CI: zadanie `build-macos-mas` w `.github/workflows/release.yml` (publiczne repo).
  Włącza się samo, gdy są sekrety `MAS_CERTIFICATE`, `MAS_CERTIFICATE_PASSWORD`
  i `MAS_PROVISIONING_PROFILE`. Wysyła `.pkg` do App Store Connect kluczem
  `APPLE_API_*` (tym samym co notaryzacja). Wydania testowe (tag z „-”) tylko budują.

### Test lokalny w piaskownicy

```bash
cd desktop
VITE_POUFNIK_DISTRIBUTION=mas npx tauri build --features mas --config src-tauri/tauri.mas.conf.json --bundles app --no-sign
python3 scripts/package_mas.py --app src-tauri/target/release/bundle/macos/Poufnik.app --out-dir /tmp/poufnik-mas --app-identity "Developer ID Application: …"
open /tmp/poufnik-mas/Poufnik.app
```

Bez `--provisioning-profile` aplikacja dostaje tylko uprawnienia piaskownicy, więc można
ją podpisać Developer ID i uruchomić. Dane aplikacji lądują w
`~/Library/Containers/KancelariaRadcyPrawnegoMi.Poufnik`. Odmowy piaskownicy:
`log show --last 10m --predicate 'eventMessage CONTAINS[c] "deny"' | grep -i poufnik`.
