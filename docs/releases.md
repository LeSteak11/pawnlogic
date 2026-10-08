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
