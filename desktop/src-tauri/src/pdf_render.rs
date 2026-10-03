//! Renders an (already anonymized) DOCX to PDF with the office suite installed on the
//! computer: Microsoft Word when present (its own layout engine gives a PDF identical to
//! what the user sees in Word), otherwise an installed LibreOffice. Nothing is bundled.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};

const RENDER_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PdfRenderer {
    Word,
    Libreoffice,
}

/// Which renderer a "Save as PDF" of a DOCX would use, if any.
#[tauri::command]
pub fn pdf_renderer() -> Option<PdfRenderer> {
    detect_renderer()
}

/// Raw DOCX bytes in, raw PDF bytes out (binary IPC, no JSON number arrays).
#[tauri::command]
pub async fn render_docx_to_pdf(request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(docx) = request.body() else {
        return Err("Oczekiwano zawartości pliku DOCX.".to_string());
    };
    let docx = docx.clone();
    let renderer = detect_renderer().ok_or_else(|| "no_renderer".to_string())?;
    let pdf = tauri::async_runtime::spawn_blocking(move || render(renderer, &docx))
        .await
        .map_err(|error| format!("Renderowanie PDF przerwane: {error}"))??;
    Ok(Response::new(pdf))
}

fn render(renderer: PdfRenderer, docx: &[u8]) -> Result<Vec<u8>, String> {
    let workdir = TempDir::create(renderer)?;
    let input = workdir.path.join("dokument.docx");
    let output = workdir.path.join("dokument.pdf");
    fs::write(&input, docx)
        .map_err(|error| format!("Nie można zapisać pliku tymczasowego: {error}"))?;

    match renderer {
        PdfRenderer::Word => render_with_word(&input, &output)?,
        PdfRenderer::Libreoffice => render_with_libreoffice(&input, &workdir.path)?,
    }
    fs::read(&output).map_err(|_| "Program biurowy nie utworzył pliku PDF.".to_string())
}

// ------------------------------------------------------------------ detection
fn detect_renderer() -> Option<PdfRenderer> {
    if word_installed() {
        return Some(PdfRenderer::Word);
    }
    libreoffice_path().map(|_| PdfRenderer::Libreoffice)
}

#[cfg(windows)]
fn word_installed() -> bool {
    let mut command = Command::new("reg");
    command.args(["query", r"HKCR\Word.Application\CurVer"]);
    hide_console(&mut command);
    command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn word_installed() -> bool {
    Path::new("/Applications/Microsoft Word.app").exists()
}

#[cfg(not(any(windows, target_os = "macos")))]
fn word_installed() -> bool {
    false
}

fn libreoffice_path() -> Option<PathBuf> {
    let candidates: &[&str] = if cfg!(windows) {
        &[
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        ]
    } else if cfg!(target_os = "macos") {
        &["/Applications/LibreOffice.app/Contents/MacOS/soffice"]
    } else {
        &["/usr/bin/soffice", "/usr/local/bin/soffice"]
    };
    candidates
        .iter()
        .map(PathBuf::from)
        .find(|path| path.exists())
}

// ---------------------------------------------------------------- renderers
// Word may already be open with the user's own documents. The script only hides and quits
// an instance it started itself (a fresh automation instance is invisible), and restores
// the alert setting it changed.
#[cfg(windows)]
const WORD_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$ownInstance = -not $word.Visible
$alerts = $word.DisplayAlerts
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($env:POUFNIK_DOCX, $false, $true, $false)
  try { $doc.SaveAs2($env:POUFNIK_PDF, 17) } finally { $doc.Close(0) }
} finally {
  $word.DisplayAlerts = $alerts
  if ($ownInstance -and $word.Documents.Count -eq 0) { $word.Quit() }
}
"#;

#[cfg(windows)]
fn render_with_word(input: &Path, output: &Path) -> Result<(), String> {
    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            WORD_SCRIPT,
        ])
        .env("POUFNIK_DOCX", input)
        .env("POUFNIK_PDF", output);
    hide_console(&mut command);
    run_with_timeout(command, "Microsoft Word")
}

// Word for Mac is sandboxed and can only open files inside its own container without
// asking the user, so the working copy is placed there (see TempDir::create).
#[cfg(target_os = "macos")]
const WORD_SCRIPT: &str = r#"
on run argv
  tell application "Microsoft Word"
    set docRef to open (POSIX file (item 1 of argv))
    save as docRef file name (POSIX file (item 2 of argv)) file format format PDF
    close docRef saving no
  end tell
end run
"#;

#[cfg(target_os = "macos")]
fn render_with_word(input: &Path, output: &Path) -> Result<(), String> {
    let mut command = Command::new("osascript");
    command.arg("-e").arg(WORD_SCRIPT).arg(input).arg(output);
    run_with_timeout(command, "Microsoft Word")
}

#[cfg(not(any(windows, target_os = "macos")))]
fn render_with_word(_input: &Path, _output: &Path) -> Result<(), String> {
    Err("no_renderer".to_string())
}

fn render_with_libreoffice(input: &Path, workdir: &Path) -> Result<(), String> {
    let soffice = libreoffice_path().ok_or_else(|| "no_renderer".to_string())?;
    // A private profile lets the conversion run even while LibreOffice is open.
    let profile = workdir.join("profil");
    let profile_url = format!(
        "file:///{}",
        profile
            .to_string_lossy()
            .replace('\\', "/")
            .trim_start_matches('/')
    );
    let mut command = Command::new(soffice);
    command
        .arg(format!("-env:UserInstallation={profile_url}"))
        .args([
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf:writer_pdf_Export",
            "--outdir",
        ])
        .arg(workdir)
        .arg(input);
    hide_console(&mut command);
    run_with_timeout(command, "LibreOffice")
}

fn run_with_timeout(mut command: Command, program: &str) -> Result<(), String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Nie można uruchomić programu {program}: {error}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => {
                let mut details = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    use std::io::Read;
                    let _ = stderr.read_to_string(&mut details);
                }
                let details = details
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .unwrap_or("")
                    .trim();
                return Err(format!("{program} nie utworzył PDF. {details}")
                    .trim()
                    .to_string());
            }
            Ok(None) if started.elapsed() > RENDER_TIMEOUT => {
                let _ = child.kill();
                return Err(format!(
                    "{program} nie odpowiada - przerwano tworzenie PDF."
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(error) => return Err(format!("Błąd programu {program}: {error}")),
        }
    }
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

// -------------------------------------------------------------- temp folder
/// Working folder removed on drop, so the anonymized copy never outlives the export.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn create(renderer: PdfRenderer) -> Result<Self, String> {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let name = format!("poufnik-pdf-{}-{unique}", std::process::id());
        let path = base_temp_dir(renderer).join(name);
        fs::create_dir_all(&path)
            .map_err(|error| format!("Nie można utworzyć folderu tymczasowego: {error}"))?;
        Ok(Self { path })
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[cfg(target_os = "macos")]
fn base_temp_dir(renderer: PdfRenderer) -> PathBuf {
    if renderer == PdfRenderer::Word {
        if let Some(home) = std::env::var_os("HOME") {
            let container =
                PathBuf::from(home).join("Library/Containers/com.microsoft.Word/Data/tmp");
            if fs::create_dir_all(&container).is_ok() {
                return container;
            }
        }
    }
    std::env::temp_dir()
}

#[cfg(not(target_os = "macos"))]
fn base_temp_dir(_renderer: PdfRenderer) -> PathBuf {
    std::env::temp_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_dir_is_removed_on_drop() {
        let path = {
            let dir = TempDir::create(PdfRenderer::Libreoffice).expect("temp dir");
            fs::write(dir.path.join("dokument.docx"), b"x").expect("write");
            dir.path.clone()
        };
        assert!(!path.exists());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires Microsoft Word; run with --ignored on a machine that has it"]
    fn renders_a_docx_with_word() {
        let docx = fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../corpus/e2e/umowa-e2e.docx"
        ))
        .expect("fixture");
        let pdf = render(PdfRenderer::Word, &docx).expect("pdf");
        assert!(pdf.starts_with(b"%PDF"));
    }
}
