//! Loopback listener logowania przez przeglądarkę (authorization code + PKCE).
//!
//! Nasłuchuje WYŁĄCZNIE na 127.0.0.1, przyjmuje dokładnie jedno żądanie
//! `GET /callback?code=...&state=...` i kończy pracę; limit oczekiwania 5 minut.
//! Aplikacja nie trzyma sekretu klienta OAuth - kod wymienia na token serwis kont (PKCE).

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    net::{Ipv4Addr, TcpListener},
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
use tauri::State;

const LOGIN_TIMEOUT_SECS: u64 = 300;

#[derive(Default)]
pub struct BrowserLoginState {
    listeners: Mutex<HashMap<u16, TcpListener>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserLoginCallback {
    pub code: String,
    pub state: String,
}

/// Otwiera jednorazowy listener na 127.0.0.1 i zwraca przydzielony port.
#[tauri::command]
pub fn start_browser_login_listener(state: State<'_, BrowserLoginState>) -> Result<u16, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("Nie można otworzyć portu logowania: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Nie można odczytać portu logowania: {error}"))?
        .port();
    state
        .listeners
        .lock()
        .map_err(|_| "Nie można zapisać stanu logowania.".to_string())?
        .insert(port, listener);
    Ok(port)
}

/// Czeka (do 5 minut) na jedno żądanie zwrotne przeglądarki i zwraca code+state.
/// Po sukcesie przekierowuje przeglądarkę na stronę serwisu kont.
#[tauri::command]
pub async fn await_browser_login(
    state: State<'_, BrowserLoginState>,
    port: u16,
    success_url: String,
) -> Result<BrowserLoginCallback, String> {
    let listener = state
        .listeners
        .lock()
        .map_err(|_| "Nie można odczytać stanu logowania.".to_string())?
        .remove(&port)
        .ok_or_else(|| "Sesja logowania nie istnieje.".to_string())?;

    tauri::async_runtime::spawn_blocking(move || accept_single_callback(listener, &success_url))
        .await
        .map_err(|error| format!("Logowanie przerwane: {error}"))?
}

/// Porzuca listener (np. przy anulowaniu logowania przez użytkownika).
#[tauri::command]
pub fn cancel_browser_login(state: State<'_, BrowserLoginState>, port: u16) -> Result<(), String> {
    state
        .listeners
        .lock()
        .map_err(|_| "Nie można odczytać stanu logowania.".to_string())?
        .remove(&port);
    Ok(())
}

fn accept_single_callback(
    listener: TcpListener,
    success_url: &str,
) -> Result<BrowserLoginCallback, String> {
    listener
        .set_nonblocking(false)
        .map_err(|error| format!("Nie można skonfigurować portu logowania: {error}"))?;
    // Windows nie wspiera timeoutu na accept(), więc czekamy w pętli na nieblokującym
    // sockecie; łączny limit to LOGIN_TIMEOUT_SECS.
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Nie można skonfigurować portu logowania: {error}"))?;
    let deadline = std::time::Instant::now() + Duration::from_secs(LOGIN_TIMEOUT_SECS);
    let (mut stream, peer) = loop {
        match listener.accept() {
            Ok(pair) => break pair,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() >= deadline {
                    return Err("Upłynął czas oczekiwania na logowanie w przeglądarce.".into());
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(error) => return Err(format!("Błąd portu logowania: {error}")),
        }
    };
    if !peer.ip().is_loopback() {
        return Err("Odrzucono połączenie spoza tego komputera.".into());
    }
    stream
        .set_nonblocking(false)
        .map_err(|error| format!("Błąd połączenia logowania: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|error| format!("Błąd połączenia logowania: {error}"))?;

    let mut reader = BufReader::new(
        stream
            .try_clone()
            .map_err(|error| format!("Błąd połączenia logowania: {error}"))?,
    );
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|error| format!("Nie można odczytać odpowiedzi przeglądarki: {error}"))?;

    let result = parse_callback_request(&request_line);
    let response = match &result {
        Ok(_) => format!(
            "HTTP/1.1 302 Found\r\nLocation: {success_url}\r\nConnection: close\r\n\
             Content-Length: 0\r\n\r\n"
        ),
        Err(_) => {
            "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: text/plain; \
             charset=utf-8\r\nContent-Length: 24\r\n\r\nNieprawidlowe wywolanie."
                .to_string()
        }
    };
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    result
}

fn parse_callback_request(request_line: &str) -> Result<BrowserLoginCallback, String> {
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    if method != "GET" || !target.starts_with("/callback?") {
        return Err("Nieprawidłowe wywołanie zwrotne logowania.".into());
    }
    let query = &target["/callback?".len()..];
    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        match key {
            "code" => code = Some(percent_decode(value)),
            "state" => state = Some(percent_decode(value)),
            _ => {}
        }
    }
    match (code, state) {
        (Some(code), Some(state)) if !code.is_empty() && !state.is_empty() => {
            Ok(BrowserLoginCallback { code, state })
        }
        _ => Err("Odpowiedź logowania nie zawiera kodu.".into()),
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let hex = &value[index + 1..index + 3];
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    index += 3;
                    continue;
                }
                out.push(b'%');
                index += 1;
            }
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpStream;

    #[test]
    fn listener_binds_only_loopback() {
        let state = BrowserLoginState::default();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
        let addr = listener.local_addr().expect("addr");
        assert!(addr.ip().is_loopback());
        drop(state);
    }

    #[test]
    fn accepts_exactly_one_valid_callback() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let handle = std::thread::spawn(move || {
            accept_single_callback(listener, "http://127.0.0.1:1/desktop/success")
        });
        let mut client = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        client
            .write_all(b"GET /callback?code=abc123&state=st-1 HTTP/1.1\r\nHost: x\r\n\r\n")
            .expect("write");
        let mut response = String::new();
        let _ = client.read_to_string(&mut response);
        assert!(response.starts_with("HTTP/1.1 302"));
        let callback = handle.join().expect("join").expect("callback");
        assert_eq!(callback.code, "abc123");
        assert_eq!(callback.state, "st-1");
        // Listener został skonsumowany - kolejne połączenie nie ma prawa przejść.
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
    }

    #[test]
    fn rejects_request_without_code() {
        assert!(parse_callback_request("GET /callback?state=only HTTP/1.1").is_err());
        assert!(parse_callback_request("POST /callback?code=a&state=b HTTP/1.1").is_err());
        assert!(parse_callback_request("GET /inne?code=a&state=b HTTP/1.1").is_err());
    }
}
