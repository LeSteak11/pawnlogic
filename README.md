# Chess Lab

Local chess laboratory: Stockfish move recommendations, game tracking, history/replay and stats. No cloud, no API keys.

## Run
Double-click `ChessLab.bat` (or the desktop shortcut). A compact Edge app window opens; it closes the server itself a few minutes after the window is closed.

First-time setup: Python 3.11+, then `engine/stockfish.exe` (Stockfish 19 x86-64 from https://stockfishchess.org/download/). The batch file creates `.venv` and installs `requirements.txt` automatically.

## Chess.com workflow (computer-opponent practice only)
1. Start a bot game on Chess.com, put Chess Lab beside it.
2. Type each move (yours and the bot's) in the move box: `Nf3`, `e4`, `O-O`, or `e2e4`. Or click the board.
3. **Enter on an empty box plays the recommended move** (handy to mirror your own move). Clicking a candidate line plays it too.
4. Out of sync? Paste a FEN or PGN under *Import FEN / PGN*.
5. Fill in opponent/result and press **Save game**. Unsaved games are restored if you close the window.

No scraping, screen-reading or automated input of Chess.com. Don't use engine help against human opponents.

## Data
- `data/games.db` (SQLite) is the source of truth. PGN is generated on export.
- Back up: History tab > *Backup database*, or just copy `data/games.db`. Export all games: *Export all PGN*.
- `config.json` stores engine settings (also editable under ⚙ Settings).
- Source types: **assisted** (engine used), **independent** (no engine), **experiment** (engine-vs-engine, Phase 2). Stats are never mixed silently: the Dashboard has a filter. Win % = wins / scored games; unfinished games and experiments aren't scored.

## Layout
```
app/        server.py (API), engine.py (Engine interface + Stockfish), db.py, static/ (UI)
engine/     stockfish.exe (not in git)
data/       games.db, exports/
run.py      launcher        ChessLab.bat   Windows entry point
```
Add another engine: subclass `Engine` in `app/engine.py` and register it in `ENGINES`.

## Status
Phase 1 (analysis, save, history, dashboard) done. Phase 2: engine-vs-engine experiments.
