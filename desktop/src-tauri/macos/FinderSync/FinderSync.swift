// Rozszerzenie Findera (Finder Sync): pozycje „Poufnik – …” od razu w menu po kliknięciu
// prawym przyciskiem na pliku, a nie w podmenu „Usługi” (mac_services.rs zostaje jako zapas).
//
// Rozszerzenie działa w piaskownicy i niczego nie czyta z pliku. Uruchamia Poufnika z
// argumentami `--poufnik-action <akcja> <ścieżka>...`, tak jak menu Eksploratora na Windows.
// Gdy Poufnik już działa, tauri-plugin-single-instance przekazuje argumenty do działającej
// kopii (shell_actions.rs), a nowa kończy pracę.
//
// Tylko wersja z DMG: aplikacja z Mac App Store nie może zapisać wyniku obok pliku.

import AppKit
import FinderSync
import UniformTypeIdentifiers

private struct PoufnikAction {
    let id: String
    let title: String
    let types: [UTType]
}

// Te same akcje i typy plików co NSServices w Info.services.plist.
private let documents: [UTType] = [
    .pdf, .rtf, .plainText, .image,
    UTType("org.openxmlformats.wordprocessingml.document"),
    UTType("com.microsoft.word.doc"),
    UTType("org.oasis-open.opendocument.text"),
    UTType("org.openxmlformats.spreadsheetml.sheet"),
    UTType("org.oasis-open.opendocument.spreadsheet"),
    UTType("org.openxmlformats.presentationml.presentation"),
    UTType("org.oasis-open.opendocument.presentation"),
    UTType("net.daringfireball.markdown"),
].compactMap { $0 }

private let actions: [PoufnikAction] = [
    PoufnikAction(id: "anonymize", title: "Poufnik – Anonimizuj", types: documents),
    PoufnikAction(id: "markdown", title: "Poufnik – Anonimizuj do Markdown (dla AI)", types: documents),
    PoufnikAction(id: "restore", title: "Poufnik – Przywróć dane", types: [
        .pdf, .plainText,
        UTType("org.openxmlformats.wordprocessingml.document"),
        UTType("net.daringfireball.markdown"),
    ].compactMap { $0 }),
    PoufnikAction(id: "metadata", title: "Poufnik – Usuń metadane", types: [
        .pdf, .image,
        UTType("org.openxmlformats.wordprocessingml.document"),
        UTType("org.openxmlformats.spreadsheetml.sheet"),
        UTType("org.openxmlformats.presentationml.presentation"),
    ].compactMap { $0 }),
    PoufnikAction(id: "ocr", title: "Poufnik – Wyciągnij tekst (OCR)", types: [.pdf, .image]),
]

private func fileType(_ url: URL) -> UTType? {
    if let type = try? url.resourceValues(forKeys: [.contentTypeKey]).contentType {
        return type
    }
    return UTType(filenameExtension: url.pathExtension)
}

/// Akcja pasuje, gdy każdy zaznaczony plik ma jeden z jej typów (foldery nigdy).
private func matches(_ action: PoufnikAction, _ urls: [URL]) -> Bool {
    !urls.isEmpty && urls.allSatisfy { url in
        guard !url.hasDirectoryPath, let type = fileType(url) else { return false }
        return action.types.contains { type.conforms(to: $0) }
    }
}

@objc(FinderSync)
final class FinderSync: FIFinderSync {
    override init() {
        super.init()
        // Menu na plikach w każdym folderze, nie tylko w wybranych.
        FIFinderSyncController.default().directoryURLs = [URL(fileURLWithPath: "/")]
    }

    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
        guard menuKind == .contextualMenuForItems else { return nil }
        let urls = FIFinderSyncController.default().selectedItemURLs() ?? []
        let menu = NSMenu(title: "")
        for (index, action) in actions.enumerated() where matches(action, urls) {
            let item = NSMenuItem(title: action.title, action: #selector(run(_:)), keyEquivalent: "")
            item.tag = index
            item.target = self
            menu.addItem(item)
        }
        return menu.items.isEmpty ? nil : menu
    }

    @objc private func run(_ sender: NSMenuItem) {
        guard actions.indices.contains(sender.tag) else { return }
        let action = actions[sender.tag]
        let urls = (FIFinderSyncController.default().selectedItemURLs() ?? []).filter { !$0.hasDirectoryPath }
        guard !urls.isEmpty else { return }
        // Poufnik.app/Contents/PlugIns/PoufnikFinder.appex → Poufnik.app
        let app = Bundle.main.bundleURL
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.arguments = ["--poufnik-action", action.id] + urls.map(\.path)
        // Nowa kopia za każdym razem: inaczej macOS tylko aktywuje działającą i gubi argumenty.
        configuration.createsNewApplicationInstance = true
        configuration.activates = false
        NSWorkspace.shared.openApplication(at: app, configuration: configuration) { _, error in
            if let error {
                NSLog("Poufnik: nie udało się uruchomić aplikacji: %@", error.localizedDescription)
            }
        }
    }
}
