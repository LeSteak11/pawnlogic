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

## Auto-sync from Chess.com computer games (optional)
`extension/` is a small read-only Chrome extension. It runs only on Chess.com's play-the-computer pages, reads which pieces are where, and sends that to Chess Lab on this PC. It never clicks or plays moves.
1. Chrome > `chrome://extensions` > turn on *Developer mode* > *Load unpacked* > pick the `extension` folder.
2. Open Chess Lab, leave *Auto-sync from Chess.com* ticked, then start a computer game on Chess.com.
3. Chess Lab shows "connected", follows both sides' moves, and recommends your move. Don't type moves while sync is on.
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
