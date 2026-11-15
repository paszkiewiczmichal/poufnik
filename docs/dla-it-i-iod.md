# Poufnik: informacje dla działu IT i inspektora ochrony danych

Poufnik anonimizuje dokumenty na komputerze użytkownika. Treść dokumentów nie jest przesyłana poza ten komputer: rozpoznawanie danych, OCR i zapis plików wykonuje lokalny silnik uruchamiany razem z aplikacją.

## Połączenia sieciowe

| Cel | Adres | Kiedy | Co jest przesyłane |
|---|---|---|---|
| Lokalny silnik | `http://127.0.0.1:<losowy port>` | stale, w czasie pracy aplikacji | dokumenty i wyniki; ruch nie opuszcza komputera |
| Konto użytkownika (opcjonalne) | `https://account.lawtern.com` | logowanie, odświeżenie sesji | adres e-mail i hasło albo token sesji; bez treści dokumentów |
| Aktualizacje (tylko wersja z GitHuba) | `https://github.com/paszkiewiczmichal/poufnik/releases/latest/download/latest.json` | po zgodzie użytkownika | brak danych użytkownika |

Polityka bezpieczeństwa treści aplikacji (CSP) zezwala wyłącznie na te adresy; test `desktop/src/security/offlineGuard.test.ts` pilnuje, żeby żaden inny nie pojawił się w kodzie. Aplikacja działa bez konta i bez dostępu do internetu; bez internetu nie działa tylko logowanie i aktualizacja.

Lokalny silnik nasłuchuje wyłącznie na adresie `127.0.0.1`, na porcie wybieranym przy każdym uruchomieniu, i przyjmuje tylko zapytania z tokenem generowanym przy starcie (32 bajty losowe).

## Dane zapisywane na dysku

Wszystko w profilu użytkownika, w katalogu danych aplikacji (`KancelariaRadcyPrawnegoMi.Poufnik`):

| Dane | Gdzie | Uwagi |
|---|---|---|
| Mapy zastąpień z menu kontekstowego i anonimizacji | `menu-maps\*.json` (dane lokalne aplikacji) | pozwalają przywrócić dane w odpowiedzi z AI; zawierają oryginalne wartości |
| Historia dokumentów | `document-history.sqlite3` | tylko gdy użytkownik włączy historię w Ustawieniach |
| Sesja konta | `auth\session.json` | token sesji, bez hasła |
| Ustawienia | magazyn przeglądarki wbudowanej (WebView) | kategorie, tryb zastąpienia, profil dokumentu |

Mapę zastąpień zapisaną ręcznie użytkownik może zaszyfrować hasłem (AES-256-GCM, klucz z hasła przez PBKDF2-SHA-256, 600 000 iteracji). Bez hasła mapy nie da się odczytać; Poufnik hasła nie przechowuje.

Pliki wynikowe Poufnik zapisuje obok oryginału albo w miejscu wskazanym przez użytkownika; oryginału nigdy nie nadpisuje.

## Co anonimizacja usuwa z pliku

- Dane wskazane w przeglądzie, w treści, nagłówkach, stopkach, przypisach, polach formularzy i tekstach alternatywnych.
- Dane widoczne na obrazach wklejonych do plików Word, Excel i PowerPoint (OCR i zamalowanie).
- Komentarze i metadane (autor, daty, ścieżki); śledzone zmiany zostają zaakceptowane.
- W PDF: tekst usuwany z samego pliku, nie tylko zakrywany; skany przez OCR i zamalowanie.

Po zapisie Poufnik ponownie czyta plik wynikowy i odmawia zapisu, jeżeli którakolwiek wartość oznaczona do anonimizacji nadal w nim jest.

Do akt można zapisać raport z anonimizacji (PDF): kategorie, oznaczenia, liczby wystąpień i decyzje użytkownika, bez danych z dokumentu.

## Wdrożenie

- Microsoft Store: `winget install --id 9P6ZLK40V3LL --source msstore`; aktualizacje przez sklep.
- Instalator z GitHuba (NSIS, instalacja na użytkownika): cicha instalacja parametrem `/S`.
- macOS: plik DMG podpisany Developer ID i notaryzowany przez Apple, albo Mac App Store.

## Weryfikacja i składniki

- Instalatory Windows podpisane przez Azure Trusted Signing; DMG podpisane i notaryzowane.
- Do każdego wydania na GitHubie dołączone są sumy SHA-256 i spis składników (SBOM, CycloneDX) silnika i interfejsu.
- Kod źródłowy: <https://github.com/paszkiewiczmichal/poufnik> (Apache 2.0). Zgłaszanie podatności: plik `SECURITY.md` w repozytorium.

## Ograniczenia

Poufnik wykrywa dane automatycznie i nie gwarantuje wykrycia każdej informacji pozwalającej zidentyfikować osobę. Użytkownik przegląda wynik przed zapisem; za ocenę, czy dokument po anonimizacji nadal umożliwia identyfikację (motyw 26 RODO), odpowiada administrator danych.
