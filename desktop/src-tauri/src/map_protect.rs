//! Encryption at rest for the replacement maps Poufnik remembers (menu-maps folder).
//!
//! Windows: DPAPI (CryptProtectData / CryptUnprotectData) bound to the current Windows user,
//! so a copied file is useless on another account or machine. No key is managed by Poufnik.
//!
//! macOS: AES-256-GCM with a random key generated on first use and kept in the user's login
//! Keychain (generic password, readable only by this signed app without a prompt), so a
//! copied file is useless without that Keychain. A plaintext map written by 1.1.0 on a Mac
//! is still readable; it disappears with the 30-day cleanup.
//!
//! Other systems (Linux): the bytes are stored unchanged.
//!
//! The commands move raw bytes (no JSON number arrays): the request body is the data, the
//! response is the result.

use tauri::ipc::{InvokeBody, Request, Response};

#[cfg(windows)]
mod imp {
    use std::{ptr, slice};

    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    fn run(
        data: &[u8],
        op: impl FnOnce(*const CRYPT_INTEGER_BLOB, *mut CRYPT_INTEGER_BLOB) -> i32,
    ) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(data.len()).map_err(|_| "Mapa jest za duża.".to_string())?,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        if op(&input, &mut output) == 0 {
            return Err("Windows odmówił zaszyfrowania lub odszyfrowania mapy.".to_string());
        }
        // SAFETY: on success DPAPI allocated `cbData` bytes at `pbData`; copied, then freed.
        let result = unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
        unsafe { LocalFree(output.pbData as _) };
        Ok(result)
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        run(data, |input, output| unsafe {
            CryptProtectData(
                input,
                ptr::null(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                output,
            )
        })
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        run(data, |input, output| unsafe {
            CryptUnprotectData(
                input,
                ptr::null_mut(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                output,
            )
        })
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::Mutex;

    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Key, Nonce};
    use security_framework::base::Error as KeychainError;
    use security_framework::passwords::{get_generic_password, set_generic_password};

    const SERVICE: &str = "Poufnik – klucz zapamiętanych map";
    const ACCOUNT: &str = "maps-v1";
    /// Marks an encrypted map: magic, then a 12-byte nonce, then ciphertext with its tag.
    const MAGIC: &[u8; 4] = b"PMK1";
    const NONCE_LEN: usize = 12;
    // errSecItemNotFound / errSecDuplicateItem from Security.framework.
    const NOT_FOUND: i32 = -25300;
    const DUPLICATE: i32 = -25299;

    static KEY: Mutex<Option<[u8; 32]>> = Mutex::new(None);

    fn keychain_error(error: KeychainError) -> String {
        format!("Pęk kluczy macOS odmówił dostępu do klucza map ({}).", error.code())
    }

    /// The map key from the Keychain, created on first use. Cached for the session.
    fn key_for(service: &str) -> Result<[u8; 32], String> {
        let mut cached = KEY.lock().map_err(|_| "Klucz map jest niedostępny.".to_string())?;
        if service == SERVICE {
            if let Some(key) = *cached {
                return Ok(key);
            }
        }
        let key = match get_generic_password(service, ACCOUNT) {
            Ok(bytes) => bytes
                .try_into()
                .map_err(|_| "Klucz map w Pęku kluczy jest uszkodzony.".to_string())?,
            Err(error) if error.code() == NOT_FOUND => {
                let mut fresh = [0u8; 32];
                getrandom::fill(&mut fresh).map_err(|_| "Nie udało się wylosować klucza map.".to_string())?;
                match set_generic_password(service, ACCOUNT, &fresh) {
                    Ok(()) => fresh,
                    // Created in the meantime by another call: use the stored one.
                    Err(error) if error.code() == DUPLICATE => get_generic_password(service, ACCOUNT)
                        .map_err(keychain_error)?
                        .try_into()
                        .map_err(|_| "Klucz map w Pęku kluczy jest uszkodzony.".to_string())?,
                    Err(error) => return Err(keychain_error(error)),
                }
            }
            Err(error) => return Err(keychain_error(error)),
        };
        if service == SERVICE {
            *cached = Some(key);
        }
        Ok(key)
    }

    pub(super) fn protect_with(service: &str, data: &[u8]) -> Result<Vec<u8>, String> {
        let key = key_for(service)?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        let mut nonce = [0u8; NONCE_LEN];
        getrandom::fill(&mut nonce).map_err(|_| "Nie udało się zaszyfrować mapy.".to_string())?;
        let sealed = cipher
            .encrypt(Nonce::from_slice(&nonce), data)
            .map_err(|_| "Nie udało się zaszyfrować mapy.".to_string())?;
        let mut stored = Vec::with_capacity(MAGIC.len() + NONCE_LEN + sealed.len());
        stored.extend_from_slice(MAGIC);
        stored.extend_from_slice(&nonce);
        stored.extend_from_slice(&sealed);
        Ok(stored)
    }

    pub(super) fn unprotect_with(service: &str, data: &[u8]) -> Result<Vec<u8>, String> {
        let Some(rest) = data.strip_prefix(MAGIC.as_slice()) else {
            // A plaintext map from 1.1.0 (JSON object); anything else is not a map.
            return if data.first() == Some(&b'{') {
                Ok(data.to_vec())
            } else {
                Err("To nie jest zapamiętana mapa Poufnika.".to_string())
            };
        };
        if rest.len() <= NONCE_LEN {
            return Err("Zapamiętana mapa jest uszkodzona.".to_string());
        }
        let (nonce, sealed) = rest.split_at(NONCE_LEN);
        let key = key_for(service)?;
        Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key))
            .decrypt(Nonce::from_slice(nonce), sealed)
            .map_err(|_| "Nie można odszyfrować mapy (inny użytkownik albo uszkodzony plik).".to_string())
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        protect_with(SERVICE, data)
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        unprotect_with(SERVICE, data)
    }

    #[cfg(test)]
    pub(super) fn delete_key(service: &str) {
        let _ = security_framework::passwords::delete_generic_password(service, ACCOUNT);
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod imp {
    // Plaintext: no system key store is wired in on these systems.
    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }
}

pub use imp::{protect, unprotect};

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err("Oczekiwano surowych bajtów.".to_string()),
    }
}

/// Encrypts the bytes sent as the request body; returns the protected bytes.
#[tauri::command]
pub fn protect_map(request: Request<'_>) -> Result<Response, String> {
    protect(raw_body(&request)?).map(Response::new)
}

/// Decrypts bytes produced by `protect_map` (same Windows user); errors when they cannot be.
#[tauri::command]
pub fn unprotect_map(request: Request<'_>) -> Result<Response, String> {
    unprotect(raw_body(&request)?).map(Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn dpapi_round_trip_hides_plaintext() {
        let plain = br#"{"entries":[{"token":"[OSOBA_1]","original":"Jan Testowy"}]}"#;
        let stored = protect(plain).expect("protect");
        assert_ne!(stored.as_slice(), plain.as_slice());
        assert!(
            !stored.windows(b"Jan Testowy".len()).any(|w| w == b"Jan Testowy"),
            "stored bytes contain the plaintext"
        );
        assert_eq!(unprotect(&stored).expect("unprotect"), plain);
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_rejects_garbage() {
        assert!(unprotect(b"{\"entries\":[]}").is_err());
    }

    // The tests use their own Keychain item, removed afterwards, never the app's key.
    #[cfg(target_os = "macos")]
    const TEST_SERVICE: &str = "Poufnik – test klucza map";

    #[cfg(target_os = "macos")]
    #[test]
    fn keychain_round_trip_hides_plaintext() {
        let plain = br#"{"entries":[{"token":"[OSOBA_1]","original":"Jan Testowy"}]}"#;
        let stored = imp::protect_with(TEST_SERVICE, plain).expect("protect");
        assert!(stored.starts_with(b"PMK1"));
        assert!(
            !stored.windows(b"Jan Testowy".len()).any(|w| w == b"Jan Testowy"),
            "stored bytes contain the plaintext"
        );
        // A second encryption uses a new nonce, so equal maps do not give equal files.
        assert_ne!(stored, imp::protect_with(TEST_SERVICE, plain).expect("protect"));
        assert_eq!(imp::unprotect_with(TEST_SERVICE, &stored).expect("unprotect"), plain);
        imp::delete_key(TEST_SERVICE);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keychain_rejects_tampered_and_foreign_bytes() {
        let service = "Poufnik – test klucza map (zmiany)";
        let mut stored = imp::protect_with(service, b"{\"entries\":[]}").expect("protect");
        let last = stored.len() - 1;
        stored[last] ^= 1;
        assert!(imp::unprotect_with(service, &stored).is_err(), "tampered map was accepted");
        assert!(imp::unprotect_with(service, b"garbage").is_err());
        // A plaintext map written by 1.1.0 stays readable.
        assert_eq!(imp::unprotect_with(service, b"{\"entries\":[]}").unwrap(), b"{\"entries\":[]}");
        imp::delete_key(service);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_new_key_cannot_open_maps_of_the_old_one() {
        let service = "Poufnik – test klucza map (nowy klucz)";
        let stored = imp::protect_with(service, b"{\"entries\":[1]}").expect("protect");
        imp::delete_key(service);
        assert!(imp::unprotect_with(service, &stored).is_err(), "map opened with another key");
        imp::delete_key(service);
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    #[test]
    fn other_systems_store_bytes_unchanged() {
        assert_eq!(unprotect(&protect(b"abc").unwrap()).unwrap(), b"abc");
    }
}
