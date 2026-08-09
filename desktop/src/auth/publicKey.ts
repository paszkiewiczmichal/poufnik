export function getAccountsPublicKeyPem(): string {
  return (import.meta.env.VITE_POUFNIK_ACCOUNTS_PUBLIC_KEY_PEM || "").replace(/\\n/g, "\n");
}

