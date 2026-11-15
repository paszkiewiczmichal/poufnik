# Bezpieczeństwo Poufnika

Poufnik przetwarza dokumenty objęte tajemnicą zawodową, dlatego zgłoszenia podatności traktujemy priorytetowo.

## Jak zgłosić podatność

Zgłoszenie prosimy przesłać prywatnie, jedną z dwóch dróg:

- przez GitHub: zakładka **Security**, przycisk **Report a vulnerability**
  (<https://github.com/paszkiewiczmichal/poufnik/security/advisories/new>); zgłoszenie widzą wyłącznie opiekunowie projektu;
- e-mailem na adres <support@lawtern.com>, w temacie „Podatność”.

Prosimy nie zakładać publicznego zgłoszenia (issue) ani nie publikować szczegółów przed wydaniem poprawki.

Zgłoszenie powinno zawierać:

- wersję Poufnika i system operacyjny;
- opis podatności i jej skutków;
- kroki pozwalające ją odtworzyć, najlepiej na danych fikcyjnych.

Prosimy nie dołączać prawdziwych dokumentów ani danych osobowych.

## Terminy

| Etap | Termin |
|---|---|
| Potwierdzenie otrzymania zgłoszenia | 5 dni roboczych |
| Wstępna ocena i uzgodnienie dalszych kroków | 10 dni roboczych |
| Poprawka podatności krytycznej (np. wyciek danych z dokumentu) | 30 dni od potwierdzenia |
| Poprawka pozostałych podatności | w najbliższym wydaniu |

Po wydaniu poprawki publikujemy opis podatności (GitHub Security Advisory). Zgłaszającego wymieniamy z imienia i nazwiska, jeżeli wyrazi na to zgodę.

## Zakres

Zgłoszenia dotyczą aplikacji Poufnik (Windows, macOS), jej lokalnego silnika i instalatorów. Za podatność uważamy w szczególności:

- pozostawienie w pliku wynikowym danych, które użytkownik oznaczył do anonimizacji;
- dostęp do lokalnego silnika z innego komputera albo bez tokenu;
- wysłanie treści dokumentu poza komputer użytkownika.

Brak wykrycia danej, która nie została oznaczona automatycznie, jest błędem jakości, a nie podatnością; prosimy zgłaszać go zwykłym zgłoszeniem (issue), bez prawdziwych danych.

## Wspierane wersje

Poprawki bezpieczeństwa wydajemy dla najnowszej wersji. Aplikacja z GitHuba aktualizuje się sama po zgodzie użytkownika, wersję ze sklepów Microsoft i Apple aktualizuje sklep.

## Weryfikacja wydań

- Instalatory dla Windows są podpisane certyfikatem wydanym przez Microsoft (Azure Trusted Signing) na Kancelarię Radcy Prawnego Michał Paszkiewicz.
- Pliki DMG dla macOS są podpisane certyfikatem Developer ID i notaryzowane przez Apple.
- Do każdego wydania dołączamy sumy kontrolne SHA-256 oraz spis składników (SBOM) w formacie CycloneDX.

---

## Security policy (English)

Please report vulnerabilities privately via GitHub (**Security → Report a vulnerability**) or by e-mail to support@lawtern.com (subject "Vulnerability"). Do not open public issues or attach real documents. We acknowledge reports within 5 business days and fix critical issues (e.g. data left in an anonymized file) within 30 days.
