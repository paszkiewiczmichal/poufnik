use std::{
    env,
    net::TcpStream,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

mod browser_login;
mod history;

const ENGINE_STATUS_EVENT: &str = "engine://status";
const MAX_RESTARTS: u8 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineEndpoint {
    port: u16,
    token: String,
    base_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum EngineStatusPayload {
    Starting { attempt: u8 },
    Ready { endpoint: EngineEndpoint },
    Restarting { attempt: u8 },
    Failed { message: String },
}

#[derive(Debug)]
struct EngineState {
    endpoint: Option<EngineEndpoint>,
    child: Option<CommandChild>,
    restart_count: u8,
    failed_message: Option<String>,
    shutting_down: bool,
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            endpoint: None,
            child: None,
            restart_count: 0,
            failed_message: None,
            shutting_down: false,
        }
    }
}

type SharedEngineState = Arc<Mutex<EngineState>>;

#[derive(Debug, Clone)]
enum EngineSpawnMode {
    Dev {
        command: String,
        args: Vec<String>,
        cwd: PathBuf,
    },
    TauriSidecar {
        name: String,
        args: Vec<String>,
        cwd: PathBuf,
        tesseract_path: PathBuf,
        tessdata_dir: PathBuf,
    },
}

#[derive(Debug, Deserialize)]
struct SidecarStartup {
    port: u16,
    token: String,
}

#[tauri::command]
fn get_engine_endpoint(state: State<'_, SharedEngineState>) -> Result<EngineEndpoint, String> {
    let guard = state
        .lock()
        .map_err(|_| "Nie można odczytać stanu engine.".to_string())?;
    if let Some(message) = &guard.failed_message {
        return Err(message.clone());
    }
    guard
        .endpoint
        .clone()
        .ok_or_else(|| "Engine jeszcze się uruchamia.".to_string())
}

fn emit_status(app: &AppHandle, payload: EngineStatusPayload) {
    let _ = app.emit(ENGINE_STATUS_EVENT, payload);
}

fn spawn_engine_supervisor(app: AppHandle, state: SharedEngineState) {
    tauri::async_runtime::spawn(async move {
        let mut attempt = 0;
        loop {
            match run_engine_once(app.clone(), state.clone(), attempt).await {
                EngineRunResult::ExitedAfterReady { code } if attempt < MAX_RESTARTS => {
                    attempt = attempt.saturating_add(1);
                    emit_status(&app, EngineStatusPayload::Restarting { attempt });
                    eprintln!(
                        "anonymizer-engine exited; restarting attempt {attempt}/{MAX_RESTARTS} (code: {code:?})"
                    );
                }
                EngineRunResult::ExitedAfterReady { code } => {
                    let message = format!(
                        "Proces engine zakonczyl prace{}.",
                        code.map(|value| format!(" z kodem {value}"))
                            .unwrap_or_default()
                    );
                    fail_engine(&app, &state, &message);
                    break;
                }
                EngineRunResult::ExitedBeforeReady { code } => {
                    let message = format!(
                        "Proces engine zakonczyl prace przed gotowoscia{}.",
                        code.map(|value| format!(" z kodem {value}"))
                            .unwrap_or_default()
                    );
                    fail_engine(&app, &state, &message);
                    break;
                }
                EngineRunResult::Failed(message) => {
                    fail_engine(&app, &state, &message);
                    break;
                }
                EngineRunResult::Shutdown => break,
            }
        }
    });
}

enum EngineRunResult {
    ExitedAfterReady { code: Option<i32> },
    ExitedBeforeReady { code: Option<i32> },
    Failed(String),
    Shutdown,
}

async fn run_engine_once(app: AppHandle, state: SharedEngineState, attempt: u8) -> EngineRunResult {
    emit_status(&app, EngineStatusPayload::Starting { attempt });

    match spawn_engine_process(&app).await {
        Ok((mut rx, child)) => {
            {
                let mut guard = state.lock().expect("engine state poisoned");
                guard.child = Some(child);
                guard.endpoint = None;
                guard.failed_message = None;
            }

            let mut endpoint: Option<EngineEndpoint> = None;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) if endpoint.is_none() => {
                        let raw = String::from_utf8_lossy(&line).trim().to_string();
                        match parse_startup_line(&raw) {
                            Ok(startup) => {
                                let ready_endpoint = EngineEndpoint {
                                    port: startup.port,
                                    token: startup.token,
                                    base_url: format!("http://127.0.0.1:{}", startup.port),
                                };
                                if wait_for_health(&ready_endpoint) {
                                    {
                                        let mut guard =
                                            state.lock().expect("engine state poisoned");
                                        guard.endpoint = Some(ready_endpoint.clone());
                                        guard.restart_count = attempt;
                                    }
                                    emit_status(
                                        &app,
                                        EngineStatusPayload::Ready {
                                            endpoint: ready_endpoint.clone(),
                                        },
                                    );
                                    endpoint = Some(ready_endpoint);
                                } else {
                                    kill_current_child(&state);
                                    return EngineRunResult::Failed(
                                        "Engine uruchomil proces, ale health-check nie odpowiedzial."
                                            .to_string(),
                                    );
                                }
                            }
                            Err(message) => {
                                emit_status(
                                    &app,
                                    EngineStatusPayload::Starting {
                                        attempt: attempt.saturating_add(1),
                                    },
                                );
                                eprintln!("Ignored sidecar stdout before startup JSON: {message}");
                            }
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        eprintln!("anonymizer-engine: {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Error(message) => {
                        eprintln!("anonymizer-engine process error: {message}");
                    }
                    CommandEvent::Terminated(payload) => {
                        {
                            let mut guard = state.lock().expect("engine state poisoned");
                            guard.child = None;
                            guard.endpoint = None;
                            if guard.shutting_down {
                                return EngineRunResult::Shutdown;
                            }
                        }

                        return if endpoint.is_some() {
                            EngineRunResult::ExitedAfterReady { code: payload.code }
                        } else {
                            EngineRunResult::ExitedBeforeReady { code: payload.code }
                        };
                    }
                    _ => {}
                }
            }
            EngineRunResult::Failed("Strumien zdarzen engine zostal zamkniety.".to_string())
        }
        Err(message) => EngineRunResult::Failed(message),
    }
}

async fn spawn_engine_process(
    app: &AppHandle,
) -> Result<(tauri::async_runtime::Receiver<CommandEvent>, CommandChild), String> {
    match resolve_spawn_mode(app)? {
        EngineSpawnMode::Dev { command, args, cwd } => app
            .shell()
            .command(command)
            .args(args)
            .current_dir(cwd)
            .spawn()
            .map_err(|error| format!("Nie udalo sie uruchomic engine w trybie dev: {error}")),
        EngineSpawnMode::TauriSidecar {
            name,
            args,
            cwd,
            tesseract_path,
            tessdata_dir,
        } => app
            .shell()
            .sidecar(name)
            .map_err(|error| format!("Nie udalo sie przygotowac sidecara Tauri: {error}"))?
            .args(args)
            .current_dir(cwd)
            .env("ANONYMIZER_TESSERACT_PATH", tesseract_path)
            .env("TESSDATA_PREFIX", tessdata_dir)
            .spawn()
            .map_err(|error| format!("Nie udalo sie uruchomic sidecara Tauri: {error}")),
    }
}

fn resolve_spawn_mode(app: &AppHandle) -> Result<EngineSpawnMode, String> {
    let force_sidecar = env::var("ANONYMIZER_ENGINE_SIDECAR").is_ok_and(|value| value == "1");
    let force_dev = env::var("ANONYMIZER_ENGINE_COMMAND").is_ok();
    if force_sidecar || (!cfg!(debug_assertions) && !force_dev) {
        let binaries_dir = bundled_binaries_dir(app)?;
        let name = env::var("ANONYMIZER_ENGINE_SIDECAR_NAME")
            .unwrap_or_else(|_| "anonymizer-engine".to_string());
        return Ok(EngineSpawnMode::TauriSidecar {
            name,
            args: vec![
                "--mode".into(),
                "sidecar".into(),
                "--port".into(),
                "0".into(),
            ],
            cwd: binaries_dir.clone(),
            tesseract_path: bundled_tesseract_path(&binaries_dir),
            tessdata_dir: binaries_dir.join("tesseract").join("tessdata"),
        });
    }

    let command = env::var("ANONYMIZER_ENGINE_COMMAND").unwrap_or_else(|_| "uv".to_string());
    let args = env::var("ANONYMIZER_ENGINE_ARGS")
        .map(|raw| raw.split_whitespace().map(ToOwned::to_owned).collect())
        .unwrap_or_else(|_| {
            vec![
                "run".into(),
                "anonymizer-engine".into(),
                "--mode".into(),
                "sidecar".into(),
                "--port".into(),
                "0".into(),
            ]
        });
    let cwd = env::var("ANONYMIZER_ENGINE_CWD")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("..")
                .join("engine")
        });

    Ok(EngineSpawnMode::Dev { command, args, cwd })
}

fn bundled_binaries_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    }
    app.path()
        .resource_dir()
        .map(|path| path.join("binaries"))
        .map_err(|error| format!("Nie mozna odczytac katalogu zasobow aplikacji: {error}"))
}

fn bundled_tesseract_path(binaries_dir: &std::path::Path) -> PathBuf {
    let file_name = if cfg!(target_os = "windows") {
        "tesseract.exe"
    } else {
        "tesseract"
    };
    binaries_dir.join("tesseract").join(file_name)
}

fn parse_startup_line(line: &str) -> Result<SidecarStartup, String> {
    serde_json::from_str::<SidecarStartup>(line)
        .map_err(|error| format!("Nieprawidlowy komunikat startowy engine: {error}"))
}

fn wait_for_health(endpoint: &EngineEndpoint) -> bool {
    for _ in 0..50 {
        if health_check(endpoint) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

fn health_check(endpoint: &EngineEndpoint) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", endpoint.port)) else {
        return false;
    };
    let request = format!(
        "GET /v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Api-Key: {}\r\nConnection: close\r\n\r\n",
        endpoint.token
    );
    if std::io::Write::write_all(&mut stream, request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    std::io::Read::read_to_string(&mut stream, &mut response).is_ok()
        && response.starts_with("HTTP/1.1 200")
}

fn fail_engine(app: &AppHandle, state: &SharedEngineState, message: &str) {
    {
        let mut guard = state.lock().expect("engine state poisoned");
        guard.endpoint = None;
        guard.failed_message = Some(message.to_string());
        guard.child = None;
    }
    emit_status(
        app,
        EngineStatusPayload::Failed {
            message: message.to_string(),
        },
    );
}

fn kill_current_child(state: &SharedEngineState) {
    let child = {
        let mut guard = state.lock().expect("engine state poisoned");
        guard.endpoint = None;
        guard.child.take()
    };
    if let Some(child) = child {
        let _ = child.kill();
    }
}

fn shutdown_engine(state: &SharedEngineState) {
    let child = {
        let mut guard = state.lock().expect("engine state poisoned");
        guard.shutting_down = true;
        guard.endpoint = None;
        guard.child.take()
    };
    if let Some(child) = child {
        let _ = child.kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine_state = SharedEngineState::default();
    tauri::Builder::default()
        .manage(engine_state.clone())
        .manage(browser_login::BrowserLoginState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_engine_endpoint,
            browser_login::start_browser_login_listener,
            browser_login::await_browser_login,
            browser_login::cancel_browser_login,
            history::save_document_history_entry,
            history::list_document_history,
            history::get_document_history_entry,
            history::delete_document_history_entry,
            history::clear_document_history,
        ])
        .setup({
            let engine_state = engine_state.clone();
            move |app| {
                spawn_engine_supervisor(app.handle().clone(), engine_state.clone());
                Ok(())
            }
        })
        .on_window_event(move |_window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                shutdown_engine(&engine_state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
