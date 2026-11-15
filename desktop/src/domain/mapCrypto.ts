import type { ReplacementMap } from "../types";

/**
 * A replacement map protected with a password: the map is the only key back to the data,
 * so a copy kept in the case file or sent to a colleague should not be readable alone.
 *
 * AES-256-GCM with a key from PBKDF2-SHA-256 (600 000 iterations, OWASP 2023), random salt
 * and IV; all in the window through WebCrypto, nothing leaves the computer.
 */
export const ENCRYPTED_MAP_FORMAT = "poufnik-map-encrypted";
const ITERATIONS = 600_000;

interface EncryptedMapFile {
  format: typeof ENCRYPTED_MAP_FORMAT;
  version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export class WrongMapPasswordError extends Error {
  constructor() {
    super("Nieprawidłowe hasło do mapy zastąpień albo uszkodzony plik.");
    this.name = "WrongMapPasswordError";
  }
}

export async function encryptMap(map: ReplacementMap, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const plain = new TextEncoder().encode(JSON.stringify(map));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const file: EncryptedMapFile = {
    format: ENCRYPTED_MAP_FORMAT,
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
  return JSON.stringify(file, null, 2);
}

/** True for a file written by encryptMap (it needs a password to be used). */
export function isEncryptedMap(json: string): boolean {
  try {
    return (JSON.parse(json) as Partial<EncryptedMapFile>).format === ENCRYPTED_MAP_FORMAT;
  } catch {
    return false;
  }
}

export async function decryptMap(json: string, password: string): Promise<ReplacementMap> {
  try {
    const file = JSON.parse(json) as EncryptedMapFile;
    // The iteration count comes from the file: bounded, so a damaged or crafted file cannot
    // hang the window for hours.
    if (
      file.format !== ENCRYPTED_MAP_FORMAT ||
      file.version !== 1 ||
      !Number.isInteger(file.iterations) ||
      file.iterations < 100_000 ||
      file.iterations > 5_000_000
    ) {
      throw new WrongMapPasswordError();
    }
    const key = await deriveKey(password, fromBase64(file.salt), file.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(file.iv) },
      key,
      fromBase64(file.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as ReplacementMap;
  } catch {
    // GCM authenticates the data: a wrong password and a tampered file fail the same way.
    throw new WrongMapPasswordError();
  }
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey(
    "raw",
    // The same password typed on another system may come in another Unicode form ("ą" as one
    // character or as "a" + accent).
    new TextEncoder().encode(password.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64(bytes: Uint8Array): string {
  // In chunks: spreading a large map into one call exceeds the argument limit.
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
