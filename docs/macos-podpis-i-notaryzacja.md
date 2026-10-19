# Poufnik na macOS: podpis Developer ID i notaryzacja

Od wersji 1.0.17 CI podpisuje i notaryzuje wydanie dla Maca samo, gdy w publicznym repo
`paszkiewiczmichal/poufnik` są sekrety Apple. Bez sekretów buduje jak dotąd (podpis ad-hoc,
użytkownik zdejmuje kwarantannę poleceniem `xattr`).

Wszystkie logowania i płatności robi Michał. Agent nie widzi haseł ani wartości sekretów.

## 1. Konto Apple Developer

1. developer.apple.com/programs → Enroll, zalogowanie własnym Apple ID (z włączonym 2FA).
2. Typ konta:
   - **Individual** – aktywne zwykle w ciągu godzin; jako wydawca widnieje „Michał Paszkiewicz”.
   - **Organization** – wymaga numeru D-U-N-S i weryfikacji (dni–tygodnie); wydawcą jest kancelaria.
3. Opłata 99 USD rocznie.
4. Po aktywacji: developer.apple.com/account → Membership details → **Team ID** (10 znaków).

## 2. Certyfikat „Developer ID Application”

Tworzy go wyłącznie Account Holder. Najprościej w Xcode:

1. Raz w Terminalu: `sudo xcodebuild -license accept`.
2. Xcode → Settings → Accounts → „+” → Apple ID → zaloguj.
3. Wybierz zespół → **Manage Certificates…** → „+” → **Developer ID Application**.
4. Pęk kluczy (Keychain Access) → login → Moje certyfikaty → „Developer ID Application: …”
   → prawy przycisk → Eksportuj → format `.p12`, ustaw hasło (zapisz w menedżerze haseł).
5. Pełna nazwa certyfikatu (to będzie `APPLE_SIGNING_IDENTITY`), np.
   `Developer ID Application: Michał Paszkiewicz (AB12CD34EF)`:

   ```bash
   security find-identity -v -p codesigning
   ```

## 3. Klucz App Store Connect API (notaryzacja)

1. appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API
   → Team Keys → „+”, nazwa „Poufnik CI”, dostęp **Developer**.
2. Pobierz plik `AuthKey_XXXXXXXXXX.p8` (można tylko raz).
3. Zapisz **Key ID** (10 znaków) i **Issuer ID** (UUID nad listą kluczy).

## 4. Sekrety w GitHubie

github.com/paszkiewiczmichal/poufnik → Settings → Secrets and variables → Actions →
New repository secret:

| Sekret | Wartość |
|---|---|
| `APPLE_CERTIFICATE` | plik `.p12` w base64: `base64 -i certyfikat.p12 \| pbcopy`, potem wklej |
| `APPLE_CERTIFICATE_PASSWORD` | hasło ustawione przy eksporcie `.p12` |
| `APPLE_SIGNING_IDENTITY` | pełna nazwa z kroku 2.5 |
| `APPLE_API_ISSUER` | Issuer ID |
| `APPLE_API_KEY` | Key ID |
| `APPLE_API_PRIVATE_KEY` | cała treść pliku `.p8` (z liniami BEGIN/END): `pbcopy < AuthKey_XXXXXXXXXX.p8` |

Po dodaniu sekretów usuń z dysku `.p12` i `.p8` albo przenieś je do menedżera haseł.

## 5. Co robi CI (`.github/workflows/release.yml`, zadanie macOS)

1. **Import Apple signing certificate** – certyfikat do tymczasowego pęku kluczy.
2. **Build engine sidecar** – `build_sidecar.py` podpisuje każdy plik Mach-O silnika i Tesseracta
   (Developer ID, hardened runtime, znacznik czasu); silnik z `engine/build/engine.entitlements.plist`.
   Testy dymne (start, wykrywanie, OCR) działają już na podpisanych plikach.
3. **Build Tauri installer** – Tauri podpisuje aplikację (`Entitlements.plist`: sterowanie Wordem),
   notaryzuje ją i zszywa bilet.
4. **Smoke-test engine inside the DMG** – silnik i OCR z aplikacji w gotowym DMG.
5. **Notarize DMG** – podpis, notaryzacja i zszycie samego DMG; plik w wydaniu jest podmieniany.
6. **Verify signature and Gatekeeper** – `codesign --verify --strict`, `spctl`, `stapler validate`.

Sprawdzone lokalnie (ad-hoc + hardened runtime): silnik z tymi uprawnieniami startuje,
wykrywa dane i robi OCR.

## 6. Po pierwszym podpisanym wydaniu

- Pobrać DMG z wydania na Maca i otworzyć **bez** `xattr` – ma się otworzyć bez ostrzeżeń.
- PDF przez Worda: macOS raz zapyta o zgodę na sterowanie Wordem (opis z `Info.plist`).
- Usunąć instrukcję `xattr` z opisu wydania i z README.
