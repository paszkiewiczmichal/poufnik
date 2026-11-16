//! Renders an (already anonymized) DOCX to PDF with the office suite installed on the
//! computer: Microsoft Word when present (its own layout engine gives a PDF identical to
//! what the user sees in Word), otherwise an installed LibreOffice. Nothing is bundled.
// The Mac App Store build never renders through an office program (detect_renderer below).
#![cfg_attr(feature = "mas", allow(dead_code))]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};

const RENDER_TIMEOUT: Duration = Duration::from_secs(180);

/// Pages of a spreadsheet that Excel puts into a preview PDF (the window draws far fewer).
#[cfg(windows)]
const PREVIEW_MAX_PAGES: &str = "200";

/// One office conversion at a time: Excel and PowerPoint reuse a running instance, and the
/// preview asks for the original and the anonymized file together. A script that started
/// the program quits it afterwards, which must not happen under a conversion in progress.
static CONVERSION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PdfRenderer {
    Word,
    Excel,
    PowerPoint,
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

/// Spreadsheet, presentation or OpenDocument bytes in, raw PDF bytes out, for the 1:1
/// preview. The extension travels in the "x-poufnik-extension" header. Rejects with
/// "no_renderer" when neither Microsoft Office nor LibreOffice can open the file.
#[tauri::command]
pub async fn convert_to_pdf(request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Oczekiwano zawartości pliku.".to_string());
    };
    let extension = request
        .headers()
        .get("x-poufnik-extension")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let candidates = preview_renderers(&extension)?;
    let bytes = bytes.clone();
    let pdf = tauri::async_runtime::spawn_blocking(move || {
        convert_first_working(&candidates, &bytes, &extension)
    })
    .await
    .map_err(|error| format!("Podgląd przerwany: {error}"))??;
    Ok(Response::new(pdf))
}

/// Which programs can turn a file with this extension into a PDF, best first: the Office
/// program of the file's family (its own layout engine), then LibreOffice.
fn preview_renderers(extension: &str) -> Result<Vec<PdfRenderer>, String> {
    let office = match extension {
        "xlsx" | "ods" => PdfRenderer::Excel,
        "pptx" | "odp" => PdfRenderer::PowerPoint,
        "docx" | "odt" => PdfRenderer::Word,
        _ => return Err("Podgląd obsługuje pliki XLSX, ODS, PPTX, ODP, ODT i DOCX.".to_string()),
    };
    // The App Sandbox blocks both Apple Events to Office and LibreOffice (see detect_renderer),
    // so the Mac App Store build shows the "needs Office" message instead of a failed attempt.
    if cfg!(feature = "mas") {
        return Err("no_renderer".to_string());
    }
    let mut candidates = Vec::new();
    if office_installed(office) {
        candidates.push(office);
    }
    if cfg!(not(feature = "mas")) && libreoffice_path().is_some() {
        candidates.push(PdfRenderer::Libreoffice);
    }
    if candidates.is_empty() {
        return Err("no_renderer".to_string());
    }
    Ok(candidates)
}

/// Tries the candidates in order: Excel, for one, may refuse to export on a computer
/// without any printer, and LibreOffice then still produces the preview.
fn convert_first_working(
    candidates: &[PdfRenderer],
    bytes: &[u8],
    extension: &str,
) -> Result<Vec<u8>, String> {
    let mut last_error = "no_renderer".to_string();
    for renderer in candidates {
        match convert(*renderer, bytes, extension, Target::Pdf) {
            Ok(pdf) => return Ok(pdf),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

/// What the office program writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Target {
    Pdf,
    Docx,
}

impl Target {
    fn extension(self) -> &'static str {
        match self {
            Target::Pdf => "pdf",
            Target::Docx => "docx",
        }
    }

    /// Word's WdSaveFormat: 17 = PDF, 16 = the default .docx document.
    fn word_format(self) -> &'static str {
        match self {
            Target::Pdf => "17",
            Target::Docx => "16",
        }
    }

    fn libreoffice_filter(self) -> &'static str {
        match self {
            Target::Pdf => "pdf:writer_pdf_Export",
            Target::Docx => "docx:MS Word 2007 XML",
        }
    }
}

/// DOC or RTF bytes in, DOCX bytes out: the old formats then take the DOCX path (layout
/// kept, anonymized in place). The extension travels in the "x-poufnik-extension" header.
#[tauri::command]
pub async fn convert_to_docx(request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Oczekiwano zawartości pliku.".to_string());
    };
    let extension = request
        .headers()
        .get("x-poufnik-extension")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("doc")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "doc" | "rtf") {
        return Err("Konwersja obsługuje pliki DOC i RTF.".to_string());
    }
    let bytes = bytes.clone();
    let renderer = detect_renderer().ok_or_else(|| "no_renderer".to_string())?;
    let docx = tauri::async_runtime::spawn_blocking(move || {
        convert(renderer, &bytes, &extension, Target::Docx)
    })
    .await
    .map_err(|error| format!("Konwersja przerwana: {error}"))??;
    Ok(Response::new(docx))
}

fn render(renderer: PdfRenderer, docx: &[u8]) -> Result<Vec<u8>, String> {
    convert(renderer, docx, "docx", Target::Pdf)
}

fn convert(
    renderer: PdfRenderer,
    bytes: &[u8],
    input_extension: &str,
    target: Target,
) -> Result<Vec<u8>, String> {
    let _one_at_a_time = CONVERSION_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let workdir = TempDir::create(renderer)?;
    let input = workdir.path.join(format!("dokument.{input_extension}"));
    let output = workdir.path.join(format!("dokument.{}", target.extension()));
    fs::write(&input, bytes)
        .map_err(|error| format!("Nie można zapisać pliku tymczasowego: {error}"))?;

    match renderer {
        PdfRenderer::Word => render_with_word(&input, &output, target)?,
        PdfRenderer::Excel => render_with_excel(&input, &output)?,
        PdfRenderer::PowerPoint => render_with_powerpoint(&input, &output)?,
        PdfRenderer::Libreoffice => render_with_libreoffice(&input, &workdir.path, target)?,
    }
    fs::read(&output).map_err(|_| {
        format!(
            "Program biurowy nie utworzył pliku {}.",
            target.extension().to_ascii_uppercase()
        )
    })
}

// ------------------------------------------------------------------ detection
// The App Sandbox lets the app neither send Apple Events to Word nor run LibreOffice outside
// its own sandbox (and a sandboxed Word could not open the app's temporary file anyway), so
// the Mac App Store build always falls back to the simplified PDF.
#[cfg(feature = "mas")]
fn detect_renderer() -> Option<PdfRenderer> {
    None
}

#[cfg(not(feature = "mas"))]
fn detect_renderer() -> Option<PdfRenderer> {
    if word_installed() {
        return Some(PdfRenderer::Word);
    }
    libreoffice_path().map(|_| PdfRenderer::Libreoffice)
}

/// Excel and PowerPoint are driven through COM on Windows and AppleScript on a Mac.
fn office_installed(renderer: PdfRenderer) -> bool {
    match renderer {
        PdfRenderer::Word => word_installed(),
        #[cfg(windows)]
        PdfRenderer::Excel => com_installed("Excel.Application"),
        #[cfg(windows)]
        PdfRenderer::PowerPoint => com_installed("PowerPoint.Application"),
        #[cfg(target_os = "macos")]
        PdfRenderer::Excel => Path::new("/Applications/Microsoft Excel.app").exists(),
        #[cfg(target_os = "macos")]
        PdfRenderer::PowerPoint => Path::new("/Applications/Microsoft PowerPoint.app").exists(),
        _ => false,
    }
}

#[cfg(windows)]
fn word_installed() -> bool {
    com_installed("Word.Application")
}

#[cfg(windows)]
fn com_installed(prog_id: &str) -> bool {
    let mut command = Command::new("reg");
    command.args(["query", &format!(r"HKCR\{prog_id}\CurVer")]);
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
// the settings it changed.
// DOC and RTF files often come from the other side of a case, so macros stay off
// (AutomationSecurity 3 = force disable). A dummy password makes a protected document fail
// at once instead of waiting on an invisible password prompt until the timeout.
#[cfg(windows)]
const WORD_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$ownInstance = -not $word.Visible
$alerts = $word.DisplayAlerts
$security = $word.AutomationSecurity
$word.DisplayAlerts = 0
$word.AutomationSecurity = 3
try {
  $doc = $word.Documents.Open($env:POUFNIK_DOCX, $false, $true, $false, 'poufnik-bez-hasla', 'poufnik-bez-hasla')
  try { $doc.SaveAs2($env:POUFNIK_PDF, [int]$env:POUFNIK_FORMAT) } finally { $doc.Close(0) }
} finally {
  $word.DisplayAlerts = $alerts
  $word.AutomationSecurity = $security
  if ($ownInstance -and $word.Documents.Count -eq 0) { $word.Quit() }
}
"#;

#[cfg(windows)]
fn render_with_word(input: &Path, output: &Path, target: Target) -> Result<(), String> {
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
        .env("POUFNIK_PDF", output)
        .env("POUFNIK_FORMAT", target.word_format());
    hide_console(&mut command);
    run_with_timeout(command, "Microsoft Word")
}

// Word for Mac is sandboxed and can only open files inside its own container without
// asking the user, so the working copy is placed there (see TempDir::create).
// Word's "open" returns nothing, so the document is taken as the active one afterwards
// ("set docRef to open ..." fails with "docRef is not defined", as in 1.0.15). Like the
// Windows script, Word is quit again only when this export was what started it.
#[cfg(target_os = "macos")]
const WORD_SCRIPT: &str = r#"
on run argv
  set inputPath to item 1 of argv
  set outputPath to item 2 of argv
  set wasRunning to application "Microsoft Word" is running
  tell application "Microsoft Word"
    open (POSIX file inputPath)
    set docRef to active document
    save as docRef file name outputPath file format FORMAT_PLACEHOLDER
    close docRef saving no
    if not wasRunning and (count of documents) is 0 then quit
  end tell
end run
"#;

#[cfg(target_os = "macos")]
fn render_with_word(input: &Path, output: &Path, target: Target) -> Result<(), String> {
    let format = match target {
        Target::Pdf => "format PDF",
        // In Word for Mac "format document" is DOCX (wdFormatXMLDocument = 12); the binary
        // .doc is "format document97". "format XML document" does not exist and the script
        // fails to compile.
        Target::Docx => "format document",
    };
    let script = WORD_SCRIPT.replace("FORMAT_PLACEHOLDER", format);
    let mut command = Command::new("osascript");
    command.arg("-e").arg(script).arg(input).arg(output);
    run_with_timeout(command, "Microsoft Word")
}

#[cfg(not(any(windows, target_os = "macos")))]
fn render_with_word(_input: &Path, _output: &Path, _target: Target) -> Result<(), String> {
    Err("no_renderer".to_string())
}

// Excel and PowerPoint get the same hardening as Word: macros forced off, no alerts, read-only
// open, the program quit only when this script started it (no EXCEL / POWERPNT process
// before). Paths come in environment variables, never inside the script text.
// Excel: Workbooks.Open(file, UpdateLinks 0 = never, ReadOnly, Format, Password,
// WriteResPassword, IgnoreReadOnlyRecommended, ..., AddToMru = false); the dummy passwords
// make a protected workbook fail at once. Then ExportAsFixedFormat(xlTypePDF = 0, file,
// xlQualityStandard = 0, IncludeDocProperties, IgnorePrintAreas, From, To).
#[cfg(windows)]
const EXCEL_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$ownInstance = -not (Get-Process EXCEL -ErrorAction SilentlyContinue)
$excel = New-Object -ComObject Excel.Application
$alerts = $excel.DisplayAlerts
$security = $excel.AutomationSecurity
$excel.DisplayAlerts = $false
$excel.AutomationSecurity = 3
try {
  $missing = [Type]::Missing
  $book = $excel.Workbooks.Open($env:POUFNIK_IN, 0, $true, $missing, 'poufnik', 'poufnik', $true, $missing, $missing, $missing, $missing, $missing, $false)
  try { $book.ExportAsFixedFormat(0, $env:POUFNIK_PDF, 0, $false, $false, 1, [int]$env:POUFNIK_MAX_PAGES) } finally { $book.Close($false) }
} finally {
  $excel.DisplayAlerts = $alerts
  $excel.AutomationSecurity = $security
  if ($ownInstance -and $excel.Workbooks.Count -eq 0) { $excel.Quit() }
}
"#;

// PowerPoint: Presentations.Open(file, ReadOnly = msoTrue, Untitled = msoFalse,
// WithWindow = msoFalse), SaveAs(file, ppSaveAsPDF = 32). DisplayAlerts 1 = ppAlertsNone.
#[cfg(windows)]
const POWERPOINT_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$ownInstance = -not (Get-Process POWERPNT -ErrorAction SilentlyContinue)
$app = New-Object -ComObject PowerPoint.Application
$alerts = $app.DisplayAlerts
$security = $app.AutomationSecurity
$app.DisplayAlerts = 1
$app.AutomationSecurity = 3
try {
  $presentation = $app.Presentations.Open($env:POUFNIK_IN, -1, 0, 0)
  try { $presentation.SaveAs($env:POUFNIK_PDF, 32) } finally { $presentation.Close() }
} finally {
  $app.DisplayAlerts = $alerts
  $app.AutomationSecurity = $security
  if ($ownInstance -and $app.Presentations.Count -eq 0) { $app.Quit() }
}
"#;

#[cfg(windows)]
fn run_powershell_script(
    script: &str,
    input: &Path,
    output: &Path,
    program: &str,
) -> Result<(), String> {
    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .env("POUFNIK_IN", input)
        .env("POUFNIK_PDF", output)
        .env("POUFNIK_MAX_PAGES", PREVIEW_MAX_PAGES);
    hide_console(&mut command);
    run_with_timeout(command, program)
}

#[cfg(windows)]
fn render_with_excel(input: &Path, output: &Path) -> Result<(), String> {
    run_powershell_script(EXCEL_SCRIPT, input, output, "Microsoft Excel")
}

#[cfg(windows)]
fn render_with_powerpoint(input: &Path, output: &Path) -> Result<(), String> {
    run_powershell_script(POWERPOINT_SCRIPT, input, output, "Microsoft PowerPoint")
}

// Excel and PowerPoint for Mac are sandboxed like Word: the working copy is in their own
// container (see base_temp_dir). As in the Windows scripts, the program is quit afterwards
// only when this conversion started it, and only the file opened here is closed.
// Excel's "save workbook as" takes the output as a POSIX path string (a POSIX file fails
// with -50); "open workbook ... update links" fails the same way, so plain "open" is used.
#[cfg(target_os = "macos")]
const EXCEL_SCRIPT: &str = r#"
on run argv
  set inputPath to item 1 of argv
  set outputPath to item 2 of argv
  set wasRunning to application "Microsoft Excel" is running
  tell application "Microsoft Excel"
    open (POSIX file inputPath)
    set workbookRef to active workbook
    save workbook as workbookRef filename outputPath file format PDF file format
    close workbookRef saving no
    if not wasRunning and (count of workbooks) is 0 then quit
  end tell
end run
"#;

#[cfg(target_os = "macos")]
const POWERPOINT_SCRIPT: &str = r#"
on run argv
  set inputPath to item 1 of argv
  set outputPath to item 2 of argv
  set wasRunning to application "Microsoft PowerPoint" is running
  tell application "Microsoft PowerPoint"
    open (POSIX file inputPath)
    set presentationRef to active presentation
    save presentationRef in (POSIX file outputPath) as save as PDF
    close presentationRef saving no
    if not wasRunning and (count of presentations) is 0 then quit
  end tell
end run
"#;

#[cfg(target_os = "macos")]
fn run_applescript(script: &str, input: &Path, output: &Path, program: &str) -> Result<(), String> {
    let mut command = Command::new("osascript");
    command.arg("-e").arg(script).arg(input).arg(output);
    run_with_timeout(command, program)
}

#[cfg(target_os = "macos")]
fn render_with_excel(input: &Path, output: &Path) -> Result<(), String> {
    run_applescript(EXCEL_SCRIPT, input, output, "Microsoft Excel")
}

#[cfg(target_os = "macos")]
fn render_with_powerpoint(input: &Path, output: &Path) -> Result<(), String> {
    run_applescript(POWERPOINT_SCRIPT, input, output, "Microsoft PowerPoint")
}

#[cfg(not(any(windows, target_os = "macos")))]
fn render_with_excel(_input: &Path, _output: &Path) -> Result<(), String> {
    Err("no_renderer".to_string())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn render_with_powerpoint(_input: &Path, _output: &Path) -> Result<(), String> {
    Err("no_renderer".to_string())
}

fn render_with_libreoffice(input: &Path, workdir: &Path, target: Target) -> Result<(), String> {
    let soffice = libreoffice_path().ok_or_else(|| "no_renderer".to_string())?;
    // A private profile lets the conversion run even while LibreOffice is open.
    let profile = workdir.join("profil");
    let profile_url = format!(
        "file:///{}",
        file_url_path(
            profile
                .to_string_lossy()
                .replace('\\', "/")
                .trim_start_matches('/')
        )
    );
    let mut command = Command::new(soffice);
    command
        .arg(format!("-env:UserInstallation={profile_url}"))
        .args([
            "--headless",
            "--norestore",
            "--convert-to",
            target.libreoffice_filter(),
            "--outdir",
        ])
        .arg(workdir)
        .arg(input);
    hide_console(&mut command);
    run_with_timeout(command, "LibreOffice")
}

// LibreOffice reads the profile location as a URL: a space or a Polish letter in the user
// name ("C:/Users/Jan Kowalski") must be percent-encoded.
fn file_url_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || b"/:._-~".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
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
                return Err(format!("{program} nie utworzył pliku. {details}")
                    .trim()
                    .to_string());
            }
            Ok(None) if started.elapsed() > RENDER_TIMEOUT => {
                let _ = child.kill();
                return Err(format!(
                    "{program} nie odpowiada - przerwano tworzenie pliku."
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
    let container = match renderer {
        PdfRenderer::Word => Some("com.microsoft.Word"),
        PdfRenderer::Excel => Some("com.microsoft.Excel"),
        PdfRenderer::PowerPoint => Some("com.microsoft.Powerpoint"),
        PdfRenderer::Libreoffice => None,
    };
    if let (Some(container), Some(home)) = (container, std::env::var_os("HOME")) {
        let path = PathBuf::from(home).join(format!("Library/Containers/{container}/Data/tmp"));
        if fs::create_dir_all(&path).is_ok() {
            return path;
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

    #[test]
    fn profile_url_encodes_spaces_and_polish_letters() {
        assert_eq!(
            file_url_path("C:/Users/Jan Łęcki/profil"),
            "C:/Users/Jan%20%C5%81%C4%99cki/profil"
        );
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires Microsoft Word; run with --ignored on a machine that has it"]
    fn converts_an_rtf_to_docx_with_word() {
        // \'b3 = "ł", \'f1 = "ń" in Windows-1250: the converted text must keep them.
        let rtf = br"{\rtf1\ansi\ansicpg1250{\fonttbl{\f0 Arial;}}\f0 Umowa zawarta przez Jana Kowalskiego, ul. D\'b3uga 1, Gda\'f1sk.\par}";
        let docx = convert(PdfRenderer::Word, rtf, "rtf", Target::Docx).expect("docx");
        assert_eq!(&docx[..2], b"PK", "a DOCX is a ZIP package");
        let text = zip_text(&docx);
        assert!(text.contains("Jana Kowalskiego"), "{text}");
        assert!(text.contains("Długa"), "{text}");
    }

    #[cfg(windows)]
    fn zip_text(docx: &[u8]) -> String {
        // document.xml is stored deflated; Word writes it as the main part, read it via
        // PowerShell's System.IO.Compression to avoid a zip dependency only for a test.
        let path = std::env::temp_dir().join("poufnik-convert-test.docx");
        fs::write(&path, docx).expect("write");
        let script = format!(
            "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('{}'); $e=$z.GetEntry('word/document.xml'); $r=New-Object IO.StreamReader($e.Open(), [Text.Encoding]::UTF8); [Console]::OutputEncoding=[Text.Encoding]::UTF8; $r.ReadToEnd(); $r.Close(); $z.Dispose()",
            path.display()
        );
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .expect("powershell");
        let _ = fs::remove_file(&path);
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    #[cfg(windows)]
    fn fixture(name: &str) -> Vec<u8> {
        fs::read(format!("{}/../../corpus/e2e/{name}", env!("CARGO_MANIFEST_DIR")))
            .expect("fixture")
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires Microsoft Excel; run with --ignored on a machine that has it"]
    fn converts_an_xlsx_to_pdf_with_excel() {
        let pdf = convert(PdfRenderer::Excel, &fixture("arkusz-e2e.xlsx"), "xlsx", Target::Pdf)
            .expect("pdf");
        assert!(pdf.starts_with(b"%PDF"), "a PDF starts with %PDF");
        assert!(pdf.len() > 1000, "{} bytes", pdf.len());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires Microsoft PowerPoint; run with --ignored on a machine that has it"]
    fn converts_a_pptx_to_pdf_with_powerpoint() {
        let pdf = convert(
            PdfRenderer::PowerPoint,
            &fixture("prezentacja-e2e.pptx"),
            "pptx",
            Target::Pdf,
        )
        .expect("pdf");
        assert!(pdf.starts_with(b"%PDF"), "a PDF starts with %PDF");
        assert!(pdf.len() > 1000, "{} bytes", pdf.len());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires Microsoft Office; run with --ignored on a machine that has it"]
    fn preview_candidates_put_the_office_program_before_libreoffice() {
        let candidates = preview_renderers("xlsx").expect("a converter");
        assert_eq!(candidates[0], PdfRenderer::Excel);
    }

    #[test]
    fn preview_refuses_formats_it_cannot_convert() {
        assert!(preview_renderers("exe").is_err());
        assert!(preview_renderers("").is_err());
    }

    #[cfg(feature = "mas")]
    #[test]
    fn mac_app_store_build_asks_for_office_instead_of_trying_it() {
        for extension in ["docx", "odt", "xlsx", "pptx"] {
            assert_eq!(preview_renderers(extension), Err("no_renderer".to_string()));
        }
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
