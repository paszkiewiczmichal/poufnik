//! Windows 11 Explorer context menu for Poufnik.
//!
//! Explorer shows top-level items only for packaged `IExplorerCommand` handlers declared in
//! AppxManifest.xml (`desktop4:FileExplorerContextMenus` + a `com:SurrogateServer`). This DLL
//! is that handler: a "Poufnik" item with five sub-commands, each of which starts
//! `Poufnik.exe --poufnik-action <action> <files>` from the folder the DLL is in. The
//! Microsoft Store package declares it in its own manifest; the GitHub installer registers a
//! small identity package (sparse package, `sparse/`) that points at the installation folder.
//! All the work is done by the app; nothing here reads the files.

/// Sub-commands in menu order: (action passed to Poufnik.exe, menu label).
pub const COMMANDS: [(&str, &str); 5] = [
    ("anonymize", "Anonimizuj"),
    ("ocr", "Wyciągnij tekst (OCR)"),
    ("markdown", "Anonimizuj do Markdown (dla AI)"),
    ("restore", "Przywróć dane"),
    ("metadata", "Usuń metadane"),
];

// DOC and RTF are opened through Word or LibreOffice (converted to DOCX by the app).
const DOCUMENTS: [&str; 15] = [
    "pdf", "docx", "doc", "rtf", "xlsx", "pptx", "odt", "ods", "odp", "txt", "png", "jpg", "jpeg",
    "heic", "heif",
];
const RECOGNIZABLE: [&str; 14] = [
    "pdf", "docx", "doc", "rtf", "xlsx", "pptx", "odt", "ods", "odp", "png", "jpg", "jpeg", "heic",
    "heif",
];
const RESTORABLE: [&str; 4] = ["txt", "md", "docx", "pdf"];
/// Files that carry metadata of their own (plain text and Markdown have none).
const CLEANABLE: [&str; 15] = [
    "pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "png", "jpg", "jpeg", "jpe", "heic",
    "heif", "tif", "tiff",
];

/// Whether `action` makes sense for every selected file (by extension). The same rules as
/// the GitHub installer's registry menu (desktop/src-tauri/windows/hooks.nsh).
pub fn action_applies(action: &str, paths: &[String]) -> bool {
    if paths.is_empty() {
        return false;
    }
    let allowed: &[&str] = match action {
        "anonymize" | "markdown" => &DOCUMENTS,
        "ocr" => &RECOGNIZABLE,
        "restore" => &RESTORABLE,
        "metadata" => &CLEANABLE,
        _ => return false,
    };
    paths.iter().all(|path| {
        let extension = std::path::Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase());
        extension.is_some_and(|extension| allowed.contains(&extension.as_str()))
    })
}

#[cfg(windows)]
mod com;

#[cfg(windows)]
pub use com::{DllCanUnloadNow, DllGetClassObject};

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn documents_get_every_action() {
        for (action, _) in COMMANDS {
            assert!(
                action_applies(action, &paths(&[r"C:\Akta\umowa.PDF"])),
                "{action}"
            );
        }
    }

    #[test]
    fn text_and_markdown_and_images_get_only_what_makes_sense() {
        let txt = paths(&[r"C:\a\notatka.txt"]);
        assert!(action_applies("anonymize", &txt));
        assert!(!action_applies("ocr", &txt));
        assert!(action_applies("restore", &txt));

        let md = paths(&[r"C:\a\odpowiedz.md"]);
        assert!(action_applies("restore", &md));
        assert!(!action_applies("anonymize", &md));

        let image = paths(&[r"C:\a\skan.jpeg"]);
        assert!(action_applies("ocr", &image));
        assert!(!action_applies("restore", &image));
    }

    #[test]
    fn metadata_is_offered_for_office_files_and_photos_but_not_plain_text() {
        for file in [
            r"C:\a\arkusz.xlsx",
            r"C:\a\pismo.odt",
            r"C:\a\foto.HEIC",
            r"C:\a\skan.tif",
        ] {
            assert!(action_applies("metadata", &paths(&[file])), "{file}");
        }
        assert!(!action_applies("metadata", &paths(&[r"C:\a\notatka.txt"])));
        assert!(!action_applies("metadata", &paths(&[r"C:\a\odpowiedz.md"])));
        // A TIFF gets only what Poufnik can do with it.
        assert!(!action_applies("anonymize", &paths(&[r"C:\a\skan.tif"])));
    }

    #[test]
    fn office_and_opendocument_files_are_anonymized_but_not_restored() {
        for file in [
            r"C:\a\lista.xlsx",
            r"C:\a\slajdy.PPTX",
            r"C:\a\pismo.odt",
            r"C:\a\b.ods",
        ] {
            assert!(action_applies("anonymize", &paths(&[file])), "{file}");
            assert!(action_applies("markdown", &paths(&[file])), "{file}");
            assert!(action_applies("ocr", &paths(&[file])), "{file}");
            assert!(!action_applies("restore", &paths(&[file])), "{file}");
        }
    }

    #[test]
    fn old_word_files_are_anonymized_but_not_cleaned_or_restored() {
        for file in [r"C:\a\umowa.doc", r"C:\a\pismo.RTF"] {
            assert!(action_applies("anonymize", &paths(&[file])), "{file}");
            assert!(action_applies("markdown", &paths(&[file])), "{file}");
            assert!(!action_applies("metadata", &paths(&[file])), "{file}");
            assert!(!action_applies("restore", &paths(&[file])), "{file}");
        }
    }

    #[test]
    fn every_selected_file_must_fit() {
        let mixed = paths(&[r"C:\a\umowa.pdf", r"C:\a\film.mp4"]);
        assert!(!action_applies("anonymize", &mixed));
        assert!(!action_applies("anonymize", &[]));
        assert!(!action_applies(
            "anonymize",
            &paths(&[r"C:\a\bez_rozszerzenia"])
        ));
        assert!(!action_applies("delete", &paths(&[r"C:\a\umowa.pdf"])));
    }
}
