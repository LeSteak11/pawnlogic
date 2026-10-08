# Chess Lab

Local chess laboratory: Stockfish move recommendations, game tracking, history/replay and stats. No cloud, no API keys.

## Run
Packaged Windows releases use `ChessLab-Setup-<version>.exe`. It creates the desktop shortcut, bundles Python and Stockfish, and upgrades in place while preserving games. Build and release instructions: [docs/releases.md](docs/releases.md).

For source development, double-click `ChessLab.bat`. A compact Brave app window opens (Edge fallback); the server closes itself a few minutes after the window is closed.

First-time setup: Python 3.11+, then `engine/stockfish.exe` (Stockfish 19 x86-64 from https://stockfishchess.org/download/). The batch file creates `.venv` and installs `requirements.txt` automatically.

## Chess.com workflow (computer-opponent practice only)
1. Start a bot game on Chess.com, put Chess Lab beside it.
2. Type each move (yours and the bot's) in the move box: `Nf3`, `e4`, `O-O`, or `e2e4`. Or click the board.
3. **Enter on an empty box plays the recommended move** (handy to mirror your own move). Clicking a candidate line plays it too.
4. Out of sync? Paste a FEN or PGN under *Import FEN / PGN*.
5. Fill in opponent/result and press **Save game**. Unsaved games are restored if you close the window.

No scraping, screen-reading or automated input of Chess.com. Don't use engine help against human opponents.

## Data
- `%LOCALAPPDATA%\ChessLab\data\games.db` (SQLite) is the source of truth. Existing source-folder data is migrated without deleting the originals. PGN is generated on export.
- Back up: History tab > *Backup database*. Export all games: *Export all PGN*.
- `%LOCALAPPDATA%\ChessLab\config.json` stores engine settings (also editable under ⚙ Settings).
- Source types: **assisted** (engine used), **independent** (no engine), **experiment** (engine-vs-engine, Phase 2). Stats are never mixed silently: the Dashboard has a filter. Win % = wins / scored games; unfinished games and experiments aren't scored.

## Auto-sync from Chess.com computer games (optional)
`extension/` is a small read-only Chrome extension. It reads boards on the Chess.com pages enabled by `extension/manifest.json` and sends snapshots to Chess Lab on this PC. The enabled list includes computer games, `/play/online`, `/game/`, and `/game/*` (including numbered live-game URLs). Reconnect follows this same list, so entering a game from the lobby does not detach the reader. It never clicks or plays moves.
1. Chrome > `chrome://extensions` > turn on *Developer mode* > *Load unpacked* > pick the `extension` folder.
2. Open Chess Lab, leave *Auto-sync from Chess.com* ticked, then start a computer game on Chess.com.
3. Chess Lab shows "connected", follows both sides' moves, and recommends your move. Don't type moves while sync is on.
Also works on Lichess games against Stockfish ("Stockfish level N") on lichess.org; the Lichess reader ignores human games. Chess.com boards on enabled online pages are read without checking opponent type. After updating the extension, click its reload button in the extensions page and refresh the game tab.
When a connected game feed drops, Chess Lab now makes one automatic reconnect attempt. If a new game still stays on "Waiting", click **Reconnect** beside Auto-sync. It forgets the old tab and asks the extension for a fresh board snapshot; keep the computer-game tab open (the fallback can take up to 30 seconds).
**I play** defaults to Auto and follows the synced board orientation. Choose White or Black to lock your color with your pieces at the bottom; Flip also locks the new color. Return to Auto to follow the game tab again. Manual selection survives reconnects, new-game resets, and reopening the app.
Chess.com can change its page layout, which would break the reader; the manual move box always works as a fallback.

## Experiments (engine vs engine)
Experiments tab: name it, set the game count, and configure Engine A and B (time or depth per move, skill level or Elo cap, threads, hash). Defaults: A full strength vs B capped at Elo 1800.
- Games run one at a time on a background thread; the UI polls once a second and shows a live board. Each finished game is saved immediately (source = experiment) and appears in History.
- Colors alternate every game. Each opening (from a built-in list of 24 short lines, shuffled per experiment) is played twice with colors swapped, so results aren't skewed by one deterministic game.
- Games end by checkmate/stalemate/draw rules (threefold and 50-move claimed automatically) or are adjudicated a draw at the move cap.
- Stop discards only the game in progress; Resume continues from the saved count. Closing the app mid-run leaves the experiment *Stopped*, ready to resume.
- Stats: A/D/B tally, A's score %, white-vs-black wins and an Elo difference with a 95% interval, shown only after 20 finished games.
- The server stays alive while an experiment runs even if the window is closed.

## Layout
```
app/        server.py (API), engine.py (Engine interface + Stockfish), experiments.py, db.py, static/ (UI)
engine/     stockfish.exe (not in git)
data/       games.db, exports/
run.py      launcher        ChessLab.bat   Windows entry point
```
Add another engine: subclass `Engine` in `app/engine.py` and register it in `ENGINES`.

## Status
V1 feature-complete: analysis, save, history, dashboard, experiments.

## Credits
Chess pieces: "merida" set (white and black) by Armando Hernandez Marroquin, GPLv2+, as distributed with Lichess (github.com/lichess-org/lila, public/piece/merida; licence listed in that repository's COPYING.md). Font: Inter (Google Fonts, loaded online; falls back to Segoe UI offline). Blitz confetti: canvas-confetti v1.9.3 by Kiril Vatev, ISC licence (app/static/vendor/, licence alongside).
