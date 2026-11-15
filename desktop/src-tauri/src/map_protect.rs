//! Encryption at rest for the replacement maps Poufnik remembers (menu-maps folder).
//!
//! Windows: DPAPI (CryptProtectData / CryptUnprotectData) bound to the current Windows user,
//! so a copied file is useless on another account or machine. No key is managed by Poufnik.
//!
//! Other systems (macOS): for now the bytes are stored UNCHANGED (plaintext). The Keychain
//! will replace this later; the commands keep the same shape, so the frontend does not change.
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

#[cfg(not(windows))]
mod imp {
    // Plaintext on purpose until the macOS Keychain is wired in (see the module comment).
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

    #[cfg(not(windows))]
    #[test]
    fn non_windows_is_identity_for_now() {
        assert_eq!(unprotect(&protect(b"abc").unwrap()).unwrap(), b"abc");
    }
}
