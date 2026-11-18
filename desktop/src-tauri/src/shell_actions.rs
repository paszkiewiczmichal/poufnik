//! Actions started from the Explorer context menu (right click on a file → Poufnik → …).
//!
//! The menu runs `Poufnik.exe --poufnik-action <action> <file>...`. The first launch keeps
//! the window hidden and the frontend runs the action with the same code as the window;
//! when Poufnik already runs, tauri-plugin-single-instance hands the arguments over here.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder,
};

pub const SHELL_ACTION_FLAG: &str = "--poufnik-action";
pub const SHELL_ACTION_EVENT: &str = "shell://action";
/// Small window in the screen corner with the file name and a progress bar. Without it a
/// menu action runs with no visible sign for several seconds and looks broken.
pub const PROGRESS_WINDOW: &str = "progress";
const PROGRESS_SIZE: (f64, f64) = (380.0, 128.0);
const PROGRESS_MARGIN: i32 = 16;

const ACTIONS: [&str; 5] = ["anonymize", "ocr", "markdown", "restore", "metadata"];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ShellActionRequest {
    pub action: String,
    pub paths: Vec<String>,
}

#[derive(Default)]
pub struct ShellActionState {
    pending: Mutex<Vec<ShellActionRequest>>,
}

impl ShellActionState {
    pub fn push(&self, request: ShellActionRequest) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.push(request);
        }
    }

    fn take(&self) -> Vec<ShellActionRequest> {
        self.pending
            .lock()
            .map(|mut pending| std::mem::take(&mut *pending))
            .unwrap_or_default()
    }
}

/// Reads `--poufnik-action <action> <path>...` from the process arguments (the first one is
/// the program). Anything else - a plain launch, an unknown action, no file - is `None`, so
/// the window opens as usual.
pub fn parse_shell_action(args: &[String]) -> Option<ShellActionRequest> {
    let flag = args.iter().position(|arg| arg == SHELL_ACTION_FLAG)?;
    let action = args.get(flag + 1)?;
    if !ACTIONS.contains(&action.as_str()) {
        return None;
    }
    let paths: Vec<String> = args[flag + 2..]
        .iter()
        .filter(|path| !path.is_empty())
        .cloned()
        .collect();
    if paths.is_empty() {
        return None;
    }
    Some(ShellActionRequest {
        action: action.clone(),
        paths,
    })
}

/// Called by tauri-plugin-single-instance when Poufnik is started again while it runs.
pub fn handle_second_instance(app: &AppHandle, args: &[String]) {
    match parse_shell_action(args) {
        Some(request) => queue_shell_action(app, request),
        None => show_main_window(app),
    }
}

/// Queues an action for the frontend (Explorer menu on Windows, Finder services on macOS).
pub fn queue_shell_action(app: &AppHandle, request: ShellActionRequest) {
    app.state::<ShellActionState>().push(request);
    // Not built inline: creating a webview inside this synchronous callback can deadlock on
    // Windows.
    let handle = app.clone();
    tauri::async_runtime::spawn(async move { show_progress_window(&handle) });
    let _ = app.emit(SHELL_ACTION_EVENT, ());
}

/// Shows the progress window, creating it on first use, in the bottom right corner of the
/// screen (top right on macOS, where notifications appear). It never takes the focus.
pub fn show_progress_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(PROGRESS_WINDOW) {
        let _ = window.show();
        return;
    }
    let window = match WebviewWindowBuilder::new(
        app,
        PROGRESS_WINDOW,
        WebviewUrl::App("index.html".into()),
    )
    .title("Poufnik")
    .inner_size(PROGRESS_SIZE.0, PROGRESS_SIZE.1)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .shadow(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()
    {
        Ok(window) => window,
        Err(_) => return,
    };
    if let (Ok(Some(monitor)), Ok(size)) = (window.primary_monitor(), window.outer_size()) {
        let area = monitor.work_area();
        let x = area.position.x + area.size.width as i32 - size.width as i32 - PROGRESS_MARGIN;
        let y = if cfg!(target_os = "macos") {
            area.position.y + PROGRESS_MARGIN
        } else {
            area.position.y + area.size.height as i32 - size.height as i32 - PROGRESS_MARGIN
        };
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    let _ = window.show();
}

/// A request from a menu outside the app, or `None` for an unknown action or no files.
pub fn shell_action_request(action: &str, paths: Vec<String>) -> Option<ShellActionRequest> {
    let paths: Vec<String> = paths.into_iter().filter(|path| !path.is_empty()).collect();
    (ACTIONS.contains(&action) && !paths.is_empty()).then(|| ShellActionRequest {
        action: action.to_string(),
        paths,
    })
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn take_shell_actions(state: State<'_, ShellActionState>) -> Vec<ShellActionRequest> {
    state.take()
}

/// The frontend calls this when the queue is empty. A Poufnik started only for a menu action
/// (window never shown) quits; one the user has open stays.
#[tauri::command]
pub fn finish_shell_actions(app: AppHandle, state: State<'_, ShellActionState>) {
    if !state.pending.lock().map(|p| p.is_empty()).unwrap_or(true) {
        let _ = app.emit(SHELL_ACTION_EVENT, ());
        return;
    }
    if let Some(progress) = app.get_webview_window(PROGRESS_WINDOW) {
        let _ = progress.destroy();
    }
    let visible = app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(true);
    if !visible {
        app.exit(0);
    }
}

#[tauri::command]
pub fn show_main_window_command(app: AppHandle) {
    show_main_window(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn reads_action_and_every_path() {
        let parsed = parse_shell_action(&args(&[
            "Poufnik.exe",
            "--poufnik-action",
            "anonymize",
            r"C:\Akta\umowa.pdf",
            r"C:\Akta\pismo z spacją.docx",
        ]));
        assert_eq!(
            parsed,
            Some(ShellActionRequest {
                action: "anonymize".into(),
                paths: vec![r"C:\Akta\umowa.pdf".into(), r"C:\Akta\pismo z spacją.docx".into()],
            })
        );
    }

    #[test]
    fn finder_service_request_keeps_known_actions_with_files() {
        assert_eq!(
            shell_action_request("restore", vec!["/Users/a/odpowiedz.docx".into(), String::new()]),
            Some(ShellActionRequest {
                action: "restore".into(),
                paths: vec!["/Users/a/odpowiedz.docx".into()],
            })
        );
        assert_eq!(shell_action_request("restore", vec![String::new()]), None);
        assert_eq!(shell_action_request("delete", vec!["/Users/a/x.pdf".into()]), None);
    }

    #[test]
    fn plain_launch_is_not_an_action() {
        assert_eq!(parse_shell_action(&args(&["Poufnik.exe"])), None);
    }

    #[test]
    fn unknown_action_or_missing_file_is_ignored() {
        assert_eq!(
            parse_shell_action(&args(&["Poufnik.exe", "--poufnik-action", "delete", "a.pdf"])),
            None
        );
        assert_eq!(
            parse_shell_action(&args(&["Poufnik.exe", "--poufnik-action", "ocr"])),
            None
        );
        assert_eq!(
            parse_shell_action(&args(&["Poufnik.exe", "--poufnik-action", "ocr", ""])),
            None
        );
    }

    #[test]
    fn queue_is_emptied_by_take() {
        let state = ShellActionState::default();
        state.push(ShellActionRequest {
            action: "ocr".into(),
            paths: vec!["a.png".into()],
        });
        assert_eq!(state.take().len(), 1);
        assert!(state.take().is_empty());
    }
}
