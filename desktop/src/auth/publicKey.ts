// Klucz publiczny (nie jest tajny - służy wyłącznie do weryfikacji podpisu tokenu z
// account.lawtern.com) wbudowany na stałe, tak samo jak DEFAULT_ACCOUNTS_BASE_URL w
// auth/client.ts. VITE_POUFNIK_ACCOUNTS_PUBLIC_KEY_PEM istniał dotąd tylko w lokalnym
// .env.local dewelopera (plik nigdy niecommitowany) - CI nigdy go nie ustawiało, więc
// każdy dotychczasowy zbudowany installer logował "Brak publicznego klucza serwisu kont
// w konfiguracji aplikacji." i logowanie w ogóle nie działało.
//
// 2026-09-22: ten klucz był nieaktualny względem klucza podpisującego na produkcji
// (weryfikacja podpisu tokenu zawsze kończyła się invalid_signature) - znalezione po
// tym jak certyfikacja Microsoft Store zgłosiła niedziałające logowanie przez Google.
// Zweryfikowano bezpośrednio na serwerze: klucz publiczny wyprowadzony z aktualnego
// POUFNIK_ACCOUNTS_ED25519_PRIVATE_KEY_FILE kontenera lawtern-accounts.
const DEFAULT_ACCOUNTS_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABYvYA7szynjp8AX7KkO7fsNc4MzmfttOvbM6km+QmV0=
-----END PUBLIC KEY-----`;

export function getAccountsPublicKeyPem(): string {
  return (
    import.meta.env.VITE_POUFNIK_ACCOUNTS_PUBLIC_KEY_PEM || DEFAULT_ACCOUNTS_PUBLIC_KEY_PEM
  ).replace(/\\n/g, "\n");
}

