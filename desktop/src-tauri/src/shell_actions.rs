//! Actions started from the Explorer context menu (right click on a file → Poufnik → …).
//!
//! The menu runs `Poufnik.exe --poufnik-action <action> <file>...`. The first launch keeps
//! the window hidden and the frontend runs the action with the same code as the window;
//! when Poufnik already runs, tauri-plugin-single-instance hands the arguments over here.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub const SHELL_ACTION_FLAG: &str = "--poufnik-action";
pub const SHELL_ACTION_EVENT: &str = "shell://action";

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
        Some(request) => {
            app.state::<ShellActionState>().push(request);
            let _ = app.emit(SHELL_ACTION_EVENT, ());
        }
        None => show_main_window(app),
    }
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
