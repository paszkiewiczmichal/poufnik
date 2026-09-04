# Poufnik

Poufnik is a free, open-source desktop application for anonymizing Polish documents
before sending them to LLM tools. The entire document pipeline - parsing, OCR,
detection, anonymization, exports, and prompt preparation - runs locally on the
user's machine. Documents never leave the device; nothing is uploaded to any server
or third-party AI provider.

Detection is tuned for Polish: PESEL, NIP, REGON, KRS, IDs, passports, bank accounts
and cards, land registry numbers, case signatures, addresses, GPS coordinates, IPv4/
IPv6/MAC addresses, prefixed API keys, amounts with currency, and more, alongside
names, companies, and contact details.

Download the latest Windows installer: [poufnik.app](https://poufnik.app)

## Repository structure

This repository contains the public, open-source parts of Poufnik:

- `desktop/` - Tauri 2 + React + TypeScript desktop application.
- `engine/` - Python package `anonymizer-engine`, the detection and anonymization
  engine (FastAPI surface, bundled into the desktop app as a local sidecar process).
- `corpus/` - small, entirely synthetic Polish-language evaluation corpus used by the
  engine's test suite (fictional data only, no real documents or client data).

The desktop app talks only to this local engine process on `127.0.0.1`; an automated
test (`desktop/src/security/offlineGuard.test.ts`) enforces that no other network
calls exist in the codebase, aside from the built-in updater check and an explicit,
user-initiated "open in browser" link.

## Development

Windows prerequisites for desktop development:

- Visual Studio 2022 Build Tools with the "Desktop development with C++" workload.
- `link.exe` available in the terminal used for `npm run tauri dev`.

Verify before starting Tauri:

```powershell
where link
```

If this prints nothing, install the Build Tools or open "x64 Native Tools Command Prompt for VS
2022" / "Developer PowerShell for VS 2022" and run the desktop commands there. VS Code alone is not
enough for the Rust MSVC target used by Tauri on Windows.

Engine:

```bash
cd engine
uv sync
uv run pytest
uv run ruff check .
```

Desktop:

```bash
cd desktop
npm install
npm run test
npm run lint
npm run tauri dev
```

## Releases

Tagged pushes (`v*`) build a signed Windows installer via GitHub Actions and publish
it, together with the Tauri updater manifest (`latest.json`), to this repository's
[Releases](../../releases) page. The installed application checks that manifest for
updates automatically.

## License

Apache License, Version 2.0 - see [LICENSE](LICENSE). Copyright 2026 Kancelaria
Radcy Prawnego Michal Paszkiewicz.
