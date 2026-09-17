<p align="center">
  <img src="desktop/src/assets/images/logo.webp" width="250" alt="Poufnik" />
</p>

<p align="center">
  <strong>Prepare Polish-language documents for AI without sending their contents to an external model.</strong>
</p>

<p align="center">
  <a href="https://poufnik.app">Download for Windows</a> ·
  <a href="https://github.com/paszkiewiczmichal/poufnik/releases/latest">Latest release</a> ·
  <a href="README.pl.md">Polska wersja</a>
</p>

![Poufnik - import screen](docs/images/import-screen.jpg)

Poufnik is a free, open-source desktop app for anonymising documents before using them with ChatGPT, Claude, Copilot or another AI tool. Parsing, OCR, detection, anonymisation, export and prompt preparation run on the local computer. Document content is never uploaded to an AI provider.

The app is designed for Polish documents. It recognises Polish identifiers and language patterns, including inflected names, so a document can be reviewed and anonymised before it leaves the organisation.

> The screenshot shows the import workspace in the installed app. Documents are processed locally before they are used with an AI tool.

## Why Poufnik

- **Local by design.** The document-processing pipeline runs locally. The app communicates with its engine only through `127.0.0.1`.
- **Made for Polish documents.** Detects PESEL, NIP, REGON, KRS, IDs, passports, bank accounts and payment cards, land-register numbers, case references, addresses, coordinates, IP/MAC addresses, API keys, amounts, names, organisations and contact details.
- **You remain in control.** Review each detection, keep or exclude it, change its category, merge occurrences into a common token, or add a missed fragment manually.
- **Files, scans and images.** Import PDF, DOCX and TXT, as well as scans and images. OCR is performed locally when needed.
- **Practical AI hand-off.** Copy anonymised text, export DOCX or PDF, or prepare a legal prompt containing the anonymised document.
- **Controlled reversibility.** Keep a local replacement map and restore tokens in an AI response on the same computer. The map is not copied with the anonymised text.
- **No account required.** The free Basic tier includes the complete anonymisation workflow. A free Early Bird account unlocks additional workspace features while document content remains local.

## Who it is for

- Lawyers, law firms and in-house legal teams preparing contracts, pleadings, correspondence and case files for AI-assisted work.
- HR, finance, compliance and operations teams handling personal or confidential documents.
- Consultants, researchers and public-sector professionals who need to discuss documents with AI without exposing identifiers.
- Organisations that want a practical privacy layer before adopting AI in their document workflow.

Poufnik prepares material for safer work. It does not replace legal, security or privacy review. Always verify the final text before sharing it.

## How it works

1. **Import.** Drag a file into the app or select it from disk. Poufnik accepts PDF, DOCX, TXT, JPG, PNG and HEIC files up to 50 MB.
2. **Review.** Inspect highlighted entities and use the sidebar to accept, reject or correct them. Add your own selection when extra protection is needed.
3. **Anonymise.** Accepted data is replaced with consistent tokens, such as `[OSOBA_1]` and `[PESEL_1]`.
4. **Use with AI.** Copy the safe text, export DOCX/PDF, or copy a ready prompt with the document included.
5. **Restore locally, if needed.** Paste an AI response containing tokens and restore the data with the local replacement map.

## Screenshots

### Review and correction

![Review of detected data in a fully fictional agreement](docs/images/review-screen.jpg)

### Anonymised document ready for AI

![Anonymised agreement and ready legal prompts](docs/images/result-screen.jpg)

The screenshots use [a fully fictional sample agreement](docs/demo/umowa-poufnik-demo.txt). It is safe to import when exploring the app.

## Privacy and connectivity

Document parsing, OCR, detection, anonymisation, export and restoring tokenised AI responses stay on the device. Poufnik does not send document content to an AI model or another external document-processing service.

Internet is used only for optional, separate functions, such as checking the update manifest or using an Early Bird account. Update checks are opt-in at first launch and can be changed in Settings. Explicitly opened website links use the system browser. These connections do not upload document content.

Local processing can support RODO/GDPR and AI Act processes, but compliance depends on the complete workflow, configuration and human review.

## Editions

| Edition | Availability | Includes |
| --- | --- | --- |
| **Basic** | Free, no sign-in | Full local anonymisation, review, OCR, export and prompt preparation |
| **Early Bird** | Free account | History, side-by-side comparison, batch processing and custom detection rules |
| **Pro** | Planned | More precise sensitive-data detection |
| **Enterprise** | Planned | API integration with document-management workflows |

## Install and use

1. Download the current Windows installer from [poufnik.app](https://poufnik.app) or the [latest GitHub release](https://github.com/paszkiewiczmichal/poufnik/releases/latest).
2. Install and open **Poufnik** from the Start menu.
3. Select **Start without signing in** to use Basic immediately, or create a free Early Bird account for additional features.
4. Choose whether to allow version-only update checks on the first launch.

## Repository structure

| Directory | Contents |
| --- | --- |
| `desktop/` | Tauri 2, React and TypeScript desktop app |
| `engine/` | Local Python anonymisation engine, bundled as a desktop sidecar |
| `corpus/` | Small synthetic Polish evaluation corpus used by tests |

## Development

The desktop application targets Windows. It requires Visual Studio 2022 Build Tools with the **Desktop development with C++** workload and `link.exe` available in the terminal.

```powershell
where link
```

```bash
cd engine && uv sync && uv run pytest && uv run ruff check .
cd desktop && npm install && npm run test && npm run lint && npm run tauri dev
```

## Releases

Tags matching `v*` build a signed Windows installer with GitHub Actions and publish it, together with the Tauri update manifest, on the [Releases](../../releases) page.

## License

Apache License 2.0. See [LICENSE](LICENSE). Copyright 2026 Kancelaria Radcy Prawnego Michał Paszkiewicz.
