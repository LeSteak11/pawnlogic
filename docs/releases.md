# Building and updating Chess Lab

The installed release runs a bundled Python service and opens Brave in app-window mode. Edge is used when Brave is unavailable. No Python installation or virtual environment is needed by the installed release.

## Build

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1 -Version 1.5.0
```

For this development computer, add `-Install` to build and apply the update in one command. The existing desktop shortcut will then launch the new installed version. Source edits require rebuilding this release; `ChessLab.bat` launches source directly for immediate testing.

Build prerequisites: the project's `.venv`, installed `requirements.txt`, Node.js for JavaScript syntax checks, `engine/stockfish.exe`, and Inno Setup. Pass `-IsccPath` if the compiler is not in a detected location. `-SkipInstaller` creates just the bundled app and store ZIP.

Outputs in `dist`: `ChessLab/ChessLab.exe`, `ChessLab-Setup-<version>.exe`, `ChessLab-Sync-<version>.zip`, and `SHA256SUMS-<version>.txt`. Run the installer for desktop/Start-menu shortcuts and subsequent in-place updates. Keep the same installer AppId. Update `VERSION` and pass the same release version to the build script. Extension ZIP versions are generated from the requested build version.

The build downloads Stockfish's license using the version reported by the actual binary and records a link to that exact source tag and the binary's SHA256. It refuses an unrecognized engine version. The bundled `licenses` directory includes third-party notices.

## macOS (Intel) build

GitHub Actions builds the Mac release (`.github/workflows/mac-release.yml`) on the `macos-15-intel` runner. Pushing a tag such as `v1.6.0` builds, tests, smoke-tests and attaches `ChessLab-1.6.0-mac-intel.dmg`, the extension ZIP and `SHA256SUMS-1.6.0-mac.txt` to that GitHub Release. *Actions > macOS (Intel) release > Run workflow* builds without releasing; the DMG is then a downloadable workflow artifact. The Windows installer is still built locally with `build-release.ps1` and can be uploaded to the same release.

To build on a Mac locally:

```bash
scripts/build-release-mac.sh --version 1.6.0
```

Add `--install` to copy the app to `~/Applications`. Prerequisites: `.venv` from Python 3.10-3.12 with `requirements-mac-intel.txt`, Node.js, and the Xcode command line tools. `engine/stockfish` is built automatically from the official `sf_19` source tag by `scripts/build-stockfish-mac.sh` if it is missing. The official macOS Stockfish download cannot be bundled: its x86_64 slice reads the network from the arm64 slice, and PyInstaller's thinning and re-signing breaks it.

Intel-Mac notes:
- PyTorch's last x86_64 macOS wheels are 2.2.2, and Maia-3 imports `torch.nn.RMSNorm` from torch 2.4. `app/torch_compat.py` adds an identical `RMSNorm` only when torch lacks it, so Windows is unaffected.
- The app is ad-hoc signed only. Developer ID signing and notarization need a paid Apple Developer account; add `codesign`/`notarytool` steps to the workflow once one exists.
- Mac data paths: `~/Library/Application Support/ChessLab/` (`data/games.db`, `config.json`, `logs/`, `exports/`).

## Persistent data and migration

Games: `%LOCALAPPDATA%\ChessLab\data\games.db`.
Settings: `%LOCALAPPDATA%\ChessLab\config.json`.
Logs: `%LOCALAPPDATA%\ChessLab\logs\server.log`.
Exports: `%LOCALAPPDATA%\ChessLab\exports`.

Source launches and installed launches use the same persistent data by default. Set `CHESSLAB_DATA_DIR` to an absolute separate folder for isolated development or tests; doing this suppresses automatic source-folder migration.

The first source launch copies the legacy database using SQLite backup, including committed WAL transactions, and copies config/exports without replacing existing destination files. The locally built installer embeds the source-folder path for the first installation migration. Originals remain intact. For other legacy locations, run:

```powershell
& "$env:LOCALAPPDATA\Programs\Chess Lab\ChessLab.exe" --migrate-from "C:\path\to\old\pawnlogic"
```

The installed app and its uninstaller do not delete the user-data directory. Back up games before upgrades using History → Backup database. To move data when the destination already contains games, restore/merge deliberately; migration will not overwrite them.

## Testing a release

Use `--no-window --port 18765` for a service smoke test. Verify `/api/version`, `/`, `/api/state` and `/api/analyse`. The normal extension always connects to 8765, so keep the alternate port for isolated packaging tests only. Stop a test service with `--stop --port 18765`.

The launcher identifies running Chess Lab through `/api/version` and gracefully restarts older builds. It never force-kills an arbitrary process occupying the port. Upgrades wait for experiments to stop rather than discarding them.

## Browser extension distribution

See `docs/store-listing.md` and `docs/extension-privacy.md`. The build creates a ready-to-upload ZIP, but signing in, developer registration, an HTTPS policy page, listing screenshots, submission and review are separate store requirements. A ZIP on disk is not a published extension. Once published, install the store copy in Brave to receive browser-managed updates; unpacked development copies still require manual reload.

The Windows installer supports in-place updates when run. It does not silently download new releases. An online updater can be added once a release-hosting location and signing identity are established.
