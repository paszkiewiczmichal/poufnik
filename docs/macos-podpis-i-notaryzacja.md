# Podpis Developer ID i notaryzacja wydania dla macOS

Zadanie `build-macos-installer` w `.github/workflows/release.yml` podpisuje i notaryzuje
wydanie dla Maca, gdy w repo są sekrety Apple. Bez nich buduje z podpisem ad-hoc.

## Sekrety

| Sekret | Zawartość |
|---|---|
| `APPLE_CERTIFICATE` | certyfikat „Developer ID Application” z kluczem prywatnym, `.p12` w base64 |
| `APPLE_CERTIFICATE_PASSWORD` | hasło do `.p12` |
| `APPLE_SIGNING_IDENTITY` | pełna nazwa certyfikatu (`security find-identity -v -p codesigning`) |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_PRIVATE_KEY` | klucz App Store Connect API do notaryzacji (Issuer ID, Key ID, treść `.p8`) |

## Kroki w CI

1. **Import Apple signing certificate** – certyfikat do tymczasowego pęku kluczy. Tauri
   dostaje tylko `APPLE_SIGNING_IDENTITY`, więc podpisuje z tego pęku.
2. **Build engine sidecar** – `build_sidecar.py` podpisuje każdy plik Mach-O silnika
   i Tesseracta (Developer ID, hardened runtime, znacznik czasu); silnik z
   `engine/build/engine.entitlements.plist`. Testy dymne (start, wykrywanie, OCR) działają
   na podpisanych plikach.
3. **Build Tauri installer** – Tauri podpisuje aplikację z hardened runtime
   (`desktop/src-tauri/Entitlements.plist`: Apple Events dla eksportu PDF przez Worda)
   i ją notaryzuje.
4. **Staple app inside the DMG** – zszycie biletu notaryzacji z aplikacją w DMG.
5. **Smoke-test engine inside the DMG** – silnik i OCR z aplikacji w gotowym DMG.
6. **Notarize DMG** – podpis, notaryzacja i zszycie DMG; plik w wydaniu jest podmieniany.
7. **Verify signature and Gatekeeper** – `codesign --verify --strict`, `spctl`,
   `stapler validate`.
