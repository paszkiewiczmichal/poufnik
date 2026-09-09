// Klucz publiczny (nie jest tajny - służy wyłącznie do weryfikacji podpisu tokenu z
// account.lawtern.com) wbudowany na stałe, tak samo jak DEFAULT_ACCOUNTS_BASE_URL w
// auth/client.ts. VITE_POUFNIK_ACCOUNTS_PUBLIC_KEY_PEM istniał dotąd tylko w lokalnym
// .env.local dewelopera (plik nigdy niecommitowany) - CI nigdy go nie ustawiało, więc
// każdy dotychczasowy zbudowany installer logował "Brak publicznego klucza serwisu kont
// w konfiguracji aplikacji." i logowanie w ogóle nie działało.
const DEFAULT_ACCOUNTS_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEASb8v0+B6HqhUToTKAK/tfNCPgayFgwR50zgyruDmGkA=
-----END PUBLIC KEY-----`;

export function getAccountsPublicKeyPem(): string {
  return (
    import.meta.env.VITE_POUFNIK_ACCOUNTS_PUBLIC_KEY_PEM || DEFAULT_ACCOUNTS_PUBLIC_KEY_PEM
  ).replace(/\\n/g, "\n");
}

