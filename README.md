# Chess Lab

Local chess laboratory: human-like Maia-3 move recommendations, optional Stockfish analysis, game tracking, history/replay and stats. No API keys.

Recommendations can follow the engine directly or use Human-like, Aggressive, Tactical, Positional, Solid, Defensive, Simplifying, Complicating, Endgame and fully custom play profiles. The main screen gives each control one job: actual engine strength, calculation effort, profile freedom and move variety. Forced mates are resolved before style preferences, and optional local Stockfish verification gives Maia tactical guardrails and continuation lines without an API.

## Run
Packaged Windows releases use `ChessLab-Setup-<version>.exe`. It creates the desktop shortcut, bundles the Maia-3 CPU runtime and Stockfish, and upgrades in place while preserving games. The selected Maia checkpoint downloads once from Hugging Face and is then reused from the user cache. Build and release instructions: [docs/releases.md](docs/releases.md).

For source development, double-click `ChessLab.bat`. A compact Brave app window opens (Edge fallback); the server closes itself a few minutes after the window is closed.

For an isolated side-by-side preview, double-click `ChessLab-Test.bat`. It runs on port 8766 and stores its settings and games under `.test-data`, so it does not alter the normal app on port 8765 or `%LOCALAPPDATA%\ChessLab`.

First-time setup: Python 3.11+. The batch file creates `.venv` and installs the Maia-3 CPU runtime automatically. The default 5M model downloads on first use. `engine/stockfish.exe` (Stockfish 19 x86-64 from https://stockfishchess.org/download/) is optional for Stockfish mode and required for experiments.

## Chess.com workflow (computer-opponent practice only)
1. Start a bot game on Chess.com, put Chess Lab beside it.
2. Type each move (yours and the bot's) in the move box: `Nf3`, `e4`, `O-O`, or `e2e4`. Or click the board.
3. **Enter on an empty box plays the recommended move** (handy to mirror your own move). Clicking a candidate line plays it too.
4. Out of sync? Paste a FEN or PGN under *Import FEN / PGN*.
5. Fill in opponent/result and press **Save game**. Unsaved games are restored if you close the window.

No scraping, screen-reading or automated input of Chess.com. Don't use engine help against human opponents.

## Puzzle Mode

Select **Puzzle** in the Analyze screen and enable Auto-sync. Reload the unpacked extension and refresh the Chess.com rated-puzzle tab after extension updates. Once the board appears, select **Side to move** and click **Analyze this position**. Play the suggested move on Chess.com yourself; request another analysis after its reply.

Puzzle analysis uses full-strength Stockfish with a two-second default search. Choose **Deeper analysis** for a ten-second search on difficult positions. Both are independent of game profiles, Elo caps and calculation-effort settings. Puzzle sessions do not enter game history or statistics. A finite search does not guarantee the platform's expected solution.

The manual fallback assumes no castling or en-passant rights. Automatic turn and completion detection requires explicit page metadata and is not verified across Chess.com layouts. Reconnect also depends on the extension's configured page access.

## Data
- `%LOCALAPPDATA%\ChessLab\data\games.db` (SQLite) is the source of truth. Existing source-folder data is migrated without deleting the originals. PGN is generated on export.
- Back up: History tab > *Backup database*. Export all games: *Export all PGN*.
- `%LOCALAPPDATA%\ChessLab\config.json` stores engine settings (also editable under ⚙ Settings). Maia-3 5M at Elo 1500 is the default; Fast 5M, Balanced 23M and Highest-accuracy 79M presets report whether their checkpoint is already cached. Playing strength and variety are controlled once on the main screen. Auto/Fast/Balanced/Deep calculation effort maps to local search budgets; Custom uses the exact Stockfish time, depth or node budget in Settings.
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
app/        server.py (API), engine.py (Maia-3 + Stockfish), experiments.py, db.py, static/ (UI)
engine/     stockfish.exe (not in git)
data/       games.db, exports/
run.py      launcher        ChessLab.bat   Windows entry point
```
Maia-3 runs as an official UCI subprocess on CPU. Stockfish remains the engine used by the experiment runner. Add another engine by subclassing `Engine` in `app/engine.py` and registering it in `ENGINES`.

## Status
V1 feature-complete: analysis, save, history, dashboard, experiments.

## Credits
Chess pieces: "merida" set (white and black) by Armando Hernandez Marroquin, GPLv2+, as distributed with Lichess (github.com/lichess-org/lila, public/piece/merida; licence listed in that repository's COPYING.md). Font: Inter (Google Fonts, loaded online; falls back to Segoe UI offline). Blitz confetti: canvas-confetti v1.9.3 by Kiril Vatev, ISC licence (app/static/vendor/, licence alongside).
Maia-3 inference code: University of Toronto CSSLab, AGPL-3.0, https://github.com/CSSLab/maia3. Model checkpoints are downloaded from the official UofTCSSLab Hugging Face repositories and are not stored in this repository.
