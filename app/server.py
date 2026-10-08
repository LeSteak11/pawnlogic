"""Chess Lab local server: JSON API + static UI."""
import hashlib
import io
import os
import re
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

import chess
import chess.pgn
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from . import db
from .engine import ENGINES, config_label, load_config, save_config
from .experiments import elo_estimate, label_for, runner, sanitize

STATIC = Path(__file__).parent / "static"
app = FastAPI(title="Chess Lab")
engine = ENGINES[load_config()["engine"]]()
_last_ping = time.time()
IDLE_EXIT_SECONDS = 300  # exit when the UI window has been gone this long


def bad(msg):
    raise HTTPException(400, msg)


def make_board(fen: str) -> chess.Board:
    try:
        b = chess.Board(fen)
    except ValueError as e:
        bad(f"Invalid FEN: {e}")
    if not b.is_valid():
        bad(f"Illegal position: {b.status().name}")
    return b


def entry(board: chess.Board, mv: chess.Move) -> dict:
    san = board.san(mv)
    board.push(mv)
    return {"san": san, "uci": mv.uci(), "fen": board.fen()}


def timeline(start_fen: str, ucis: list) -> list:
    b, out = make_board(start_fen), []
    for u in ucis:
        try:
            mv = chess.Move.from_uci(u)
        except ValueError:
            bad(f"Bad move {u}")
        if mv not in b.legal_moves:
            bad(f"Illegal move {u}")
        out.append(entry(b, mv))
    return out


def code_version() -> str:
    from .release import release_info
    return release_info()["version"]


@app.get("/api/version")
def version():
    from .release import release_info
    return release_info()


@app.post("/api/shutdown")
def shutdown():
    """Used by the launcher to replace an outdated server after an update."""
    if runner.running:
        bad("An experiment is running")
    threading.Timer(0.3, lambda: (engine.close(), os._exit(0))).start()
    return {"ok": True}


@app.get("/api/ping")
def ping():
    global _last_ping
    _last_ping = time.time()
    return {"ok": True}


@app.get("/api/config")
def get_config():
    return load_config()


@app.put("/api/config")
def put_config(patch: dict = Body(...)):
    return save_config(patch)


@app.post("/api/state")
def state(body: dict = Body(...)):
    b = make_board(body["fen"])
    out = {"turn": "white" if b.turn else "black", "check": b.is_check(),
           "legal": [m.uci() for m in b.legal_moves], "over": b.is_game_over(claim_draw=False),
           "result": None, "reason": None}
    if out["over"]:
        out["result"] = b.result()
        o = b.outcome()
        out["reason"] = o.termination.name.replace("_", " ").lower() if o else None
    return out


@app.post("/api/move")
def move(body: dict = Body(...)):
    b = make_board(body["fen"])
    text = body["text"].strip()
    if not text:
        bad("Empty move")
    mv = None
    try:
        mv = b.parse_san(text)
    except ValueError:
        try:
            cand = chess.Move.from_uci(text.lower())
            if cand in b.legal_moves:
                mv = cand
        except ValueError:
            pass
    if mv is None:
        bad(f"'{text}' is not a legal move here")
    return entry(b, mv)


@app.post("/api/analyse")
def analyse(body: dict = Body(...)):
    b = make_board(body["fen"])
    cfg = load_config()
    if isinstance(body.get("multipv"), int) and 1 <= body["multipv"] <= 8:
        cfg["multipv"] = body["multipv"]  # a play style asks for a few more options to choose from
    if isinstance(body.get("time_ms"), int) and 50 <= body["time_ms"] <= 10000:
        cfg["mode"], cfg["time_ms"] = "time", body["time_ms"]  # short on the clock / blitz: answer faster
    try:
        return engine.analyse(b, cfg)
    except Exception as e:  # engine missing/crashed: surface to the UI
        raise HTTPException(500, str(e))


@app.post("/api/timeline")
def tl(body: dict = Body(...)):
    return {"start_fen": body["start_fen"], "plies": timeline(body["start_fen"], body["ucis"])}


@app.post("/api/import")
def import_text(body: dict = Body(...)):
    text = body["text"].strip()
    if not text:
        bad("Nothing to import")
    looks_fen = "[" not in text and "/" in text and len(text.split()) >= 4 and "." not in text.split()[0]
    if looks_fen:
        b = make_board(text)
        return {"start_fen": b.fen(), "plies": [], "headers": {}}
    game = chess.pgn.read_game(io.StringIO(text))
    if game is None:
        bad("Couldn't read a FEN or PGN from that text")
    b = game.board()
    if not b.is_valid():
        bad("PGN start position is illegal")
    start, plies = b.fen(), []
    for mv in game.mainline_moves():
        plies.append(entry(b, mv))
    if not plies and not game.headers.get("FEN"):
        bad("No moves found in that text")
    return {"start_fen": start, "plies": plies, "headers": dict(game.headers)}


RESULT_FROM_CHOICE = {"draw": "1/2-1/2", "unknown": "*"}


ENDED = {"CHECKMATE": "checkmate", "STALEMATE": "stalemate", "INSUFFICIENT_MATERIAL": "insufficient material",
         "SEVENTYFIVE_MOVES": "75-move rule", "FIVEFOLD_REPETITION": "repetition", "FIFTY_MOVES": "50-move rule",
         "THREEFOLD_REPETITION": "repetition"}


def _game_record(body, auto_result):
    b = make_board(body["start_fen"])
    game = chess.pgn.Game()
    game.setup(b)
    node = game
    clocks = body.get("clocks") or []
    for i, u in enumerate(body["ucis"]):
        mv = chess.Move.from_uci(u)
        if mv not in b.legal_moves:
            bad(f"Illegal move {u}")
        node = node.add_variation(mv)
        if i < len(clocks) and _secs(clocks[i]) is not None:
            node.set_clock(clocks[i])  # time left after this move, as a [%clk] comment
        b.push(mv)
    my_color = body.get("my_color") or None
    source = body.get("source", "assisted")
    outcome = b.outcome(claim_draw=True)
    choice = "auto" if auto_result else body.get("result", "auto")
    if choice == "auto":
        if outcome:
            result = outcome.result()
        elif auto_result:
            result = "*"  # still in progress (or left unfinished)
        else:
            bad("Game isn't over: pick a result")
    elif choice in ("win", "loss"):
        if not my_color:
            bad("Pick your color to record a win/loss")
        result = "1-0" if (choice == "win") == (my_color == "white") else "0-1"
    elif choice in RESULT_FROM_CHOICE:
        result = RESULT_FROM_CHOICE[choice]
    else:
        bad("Unknown result")
    ended = ENDED.get(outcome.termination.name, "over") if outcome else ("in progress" if result == "*" else (body.get("how") or "result entered")[:40])
    opp = (body.get("opponent") or "").strip()
    site = (body.get("site") or "").strip() or None
    now = datetime.now()
    game.headers.update({
        "Event": "Chess Lab", "Site": site or "Chess Lab", "Date": now.strftime("%Y.%m.%d"),
        "White": "Me" if my_color == "white" else (opp or "?"),
        "Black": "Me" if my_color == "black" else (opp or "?"),
        "Result": result, "Termination": ended,
    })
    cfg = load_config() if source == "assisted" else None
    return dict(source=source, opponent=opp, my_color=my_color, result=result, start_fen=body["start_fen"],
                pgn=str(game), plies=len(body["ucis"]), notes=(body.get("notes") or "").strip(), site=site, ended=ended,
                engine_label=config_label(cfg) if cfg else None, engine_config=cfg)


@app.post("/api/games")
def save_game(body: dict = Body(...)):
    """Manual save (you pick the result). With an id it finalises the auto-saved record instead of adding a copy."""
    g = _game_record(body, auto_result=False)
    return {"id": db.upsert_game(body.get("id"), **g), "result": g["result"]}


@app.post("/api/games/live")
def autosave_game(body: dict = Body(...)):
    """Auto-save: called as moves come in; keeps one record per game up to date."""
    g = _game_record(body, auto_result=True)
    return {"id": db.upsert_game(body.get("id"), **g), "result": g["result"], "ended": g["ended"]}


@app.get("/api/games")
def games(q: str = "", source: str = "", limit: int = 50, offset: int = 0, experiment: str = ""):
    rows, total = db.list_games(q, source, min(limit, 200), offset, experiment)
    return {"games": rows, "total": total}


@app.get("/api/games/{gid}")
def game(gid: str):
    g = db.get_game(gid)
    if not g:
        raise HTTPException(404, "Game not found")
    parsed = chess.pgn.read_game(io.StringIO(g["pgn"]))
    b, plies = parsed.board(), []
    for mv in parsed.mainline_moves():
        plies.append(entry(b, mv))
    g.pop("pgn")
    return {**g, "plies": plies}


@app.post("/api/games/{gid}/result")
def set_result(gid: str, body: dict = Body(...)):
    """Record how a game ended when the board can't show it (resignation, timeout, agreed draw)."""
    g = db.get_game(gid)
    if not g:
        raise HTTPException(404, "Game not found")
    choice, how = body.get("result"), (body.get("how") or "resigned / time").strip()[:40]
    if choice in ("win", "loss"):
        if not g["my_color"]:
            bad("This game has no colour for you, so win/loss can't be worked out")
        result = "1-0" if (choice == "win") == (g["my_color"] == "white") else "0-1"
    elif choice == "draw":
        result = "1/2-1/2"
    else:
        bad("Pick win, loss or draw")
    game = chess.pgn.read_game(io.StringIO(g["pgn"]))
    game.headers["Result"], game.headers["Termination"] = result, how
    db.set_result(gid, result, str(game), how)
    return {"id": gid, "result": result}


@app.delete("/api/games/{gid}")
def del_game(gid: str):
    return {"deleted": db.delete_game(gid)}


@app.get("/api/games/{gid}/pgn")
def game_pgn(gid: str):
    g = db.get_game(gid)
    if not g:
        raise HTTPException(404, "Game not found")
    return PlainTextResponse(g["pgn"] + "\n", headers={"Content-Disposition": f'attachment; filename="game-{gid}.pgn"'})


@app.get("/api/export/pgn")
def export_all():
    return PlainTextResponse("\n\n".join(db.all_pgns()) + "\n",
                             headers={"Content-Disposition": 'attachment; filename="chess-lab-games.pgn"'})


@app.get("/api/export/db")
def export_db():
    fd, tmp = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db.backup_to(Path(tmp))
    data = Path(tmp).read_bytes()
    os.remove(tmp)
    return Response(data, media_type="application/octet-stream",
                    headers={"Content-Disposition": 'attachment; filename="chess-lab-backup.db"'})


@app.get("/api/stats")
def get_stats(source: str = ""):
    return db.stats(source)


@app.get("/api/opponents")
def opponents():
    return db.opponents()


_sync = {"seq": 0, "placement": None, "flipped": False, "at": 0.0, "source": None, "site": None, "opponent": ""}
_sources = {}  # one entry per game tab: {placement, flipped, site, at, active_at}
_sync_cv = threading.Condition()
_sync_reconnect = 0  # bumped by the UI; the extension notices and re-injects its page reader
_PLACEMENT = re.compile(r"^[pnbrqkPNBRQK1-8/]{15,71}$")


def _secs(v):
    return float(v) if isinstance(v, (int, float)) and 0 <= v < 100000 else None


def _pick_source():
    """Follow the game tab you touched last (focused it or a move happened there); drop silent tabs."""
    now = time.time()
    for k in [k for k, s in _sources.items() if now - s["at"] > 6]:
        del _sources[k]
    if not _sources:
        return
    key = max(_sources, key=lambda k: _sources[k]["active_at"])
    s = _sources[key]
    if key != _sync["source"] or s["placement"] != _sync["placement"] or s["flipped"] != _sync["flipped"]:
        _sync.update(seq=_sync["seq"] + 1, placement=s["placement"], flipped=s["flipped"], source=key, site=s["site"])
        _sync_cv.notify_all()
    _sync["opponent"] = s.get("opponent") or ""
    _sync["my_clock"], _sync["opp_clock"] = s.get("my_clock"), s.get("opp_clock")


@app.post("/api/sync")
def sync_post(body: dict = Body(...)):
    """Receives board snapshots from the Chess.com / Lichess computer-game extension (one stream per tab)."""
    pl, fl = body.get("placement"), bool(body.get("flipped"))
    if not isinstance(pl, str) or not _PLACEMENT.match(pl):
        bad("bad placement")
    key, now = str(body.get("source") or "default"), time.time()
    with _sync_cv:
        s = _sources.setdefault(key, {"placement": None, "flipped": False, "active_at": 0.0})
        changed = pl != s["placement"] or fl != s["flipped"]
        s.update(placement=pl, flipped=fl, site=body.get("site") or s.get("site"), at=now,
                 opponent=str(body.get("opponent") or s.get("opponent") or "")[:60],
                 my_clock=_secs(body.get("my_clock")), opp_clock=_secs(body.get("opp_clock")))
        if changed or body.get("focused"):
            s["active_at"] = now
        _sync["at"] = now
        _pick_source()
    # Returning the reconnect generation makes recovery nearly instant while any
    # content script is still alive. The extension alarm is the fallback when it is not.
    return {"ok": True, "recal": _sync_reconnect}


@app.get("/api/sync")
def sync_get(after: int = -1):
    """Long-poll: with ?after=<seq>, answers as soon as the synced board changes (or after ~15 s)."""
    with _sync_cv:
        if after >= 0:
            _sync_cv.wait_for(lambda: _sync["seq"] != after, timeout=15)
        return {**_sync, "connected": time.time() - _sync["at"] < 4, "tabs": len(_sources)}


@app.get("/api/sync/recal")
def sync_recal():
    """Small endpoint polled by the extension service worker when no game tab is reporting."""
    return {"n": _sync_reconnect}


@app.post("/api/sync/reconnect")
def sync_reconnect():
    """Forget stale tab state and ask the extension to attach to open game tabs again."""
    global _sync_reconnect
    with _sync_cv:
        _sync_reconnect += 1
        _sources.clear()
        _sync.update(seq=_sync["seq"] + 1, placement=None, flipped=False, at=0.0,
                     source=None, site=None, opponent="", my_clock=None, opp_clock=None)
        _sync_cv.notify_all()
        return {"ok": True, "recal": _sync_reconnect}


@app.post("/api/sync/apply")
def sync_apply(body: dict = Body(...)):
    """Work out how to get from the app's current position to the board Chess.com shows."""
    b = make_board(body["fen"])
    target, color = body["placement"], "black" if body.get("flipped") else "white"
    if b.board_fen() == target:
        return {"mode": "same"}
    for m1 in list(b.legal_moves):  # my move, or the bot's, or both (up to two plies)
        b.push(m1)
        if b.board_fen() == target:
            return {"mode": "append", "plies": timeline(body["fen"], [m1.uci()])}
        for m2 in list(b.legal_moves):
            b.push(m2)
            if b.board_fen() == target:
                return {"mode": "append", "plies": timeline(body["fen"], [m1.uci(), m2.uci()])}
            b.pop()
        b.pop()
    # Not reachable from here: a new game or a jump. Rebuild the position from the board alone.
    start = chess.Board()
    if start.board_fen() == target:
        return {"mode": "reset", "fen": start.fen(), "color": color}
    nb = chess.Board(None)
    try:
        nb.set_board_fen(target)
        nb.turn = chess.WHITE if color == "white" else chess.BLACK  # assume it's the user's turn
        nb.set_castling_fen("KQkq")
        nb.castling_rights = nb.clean_castling_rights()
        if not nb.is_valid():
            return {"mode": "ignore"}
    except ValueError:
        return {"mode": "ignore"}
    return {"mode": "reset", "fen": nb.fen(), "color": color}


def exp_view(e):
    t = e["tally"]
    e["elo"] = elo_estimate(t["a_wins"], t["draws"], t["b_wins"])
    e["live"] = runner.live if runner.running and runner.live.get("id") == e["id"] else None
    return e


@app.get("/api/experiments")
def experiments():
    return [exp_view(e) for e in db.list_experiments()]


@app.get("/api/experiments/{eid}")
def experiment(eid: str):
    e = db.get_experiment(eid)
    if not e:
        raise HTTPException(404, "Experiment not found")
    return exp_view(e)


@app.post("/api/experiments")
def new_experiment(body: dict = Body(...)):
    if runner.running:
        bad("Another experiment is already running")
    try:
        ca, cb = sanitize(body.get("a", {})), sanitize(body.get("b", {}))
        total, max_plies = int(body.get("games", 20)), int(body.get("max_plies", 300))
    except (TypeError, ValueError):
        bad("Check the numbers in the form")
    if not 2 <= total <= 2000:
        bad("Games must be between 2 and 2000")
    name = (body.get("name") or "").strip() or f"Experiment {datetime.now():%b %d %H:%M}"
    eid = db.create_experiment(name, total, max(40, min(max_plies, 600)), ca, cb, label_for(ca), label_for(cb))
    runner.start(eid)
    return {"id": eid}


@app.post("/api/experiments/{eid}/stop")
def stop_experiment(eid: str):
    runner.stop()
    return {"ok": True}


@app.post("/api/experiments/{eid}/resume")
def resume_experiment(eid: str):
    e = db.get_experiment(eid)
    if not e:
        raise HTTPException(404, "Experiment not found")
    if runner.running:
        bad("Another experiment is already running")
    if e["tally"]["games"] >= e["total_games"]:
        bad("This experiment is already complete")
    runner.start(eid)
    return {"ok": True}


@app.delete("/api/experiments/{eid}")
def delete_experiment(eid: str):
    if runner.running and runner.live.get("id") == eid:
        bad("Stop the experiment before deleting it")
    db.delete_experiment(eid)
    return {"deleted": True}


def _watchdog():
    global _last_ping
    while True:
        time.sleep(10)
        if runner.running:
            _last_ping = time.time()  # stay alive while an experiment runs with the window closed
        elif time.time() - _last_ping > IDLE_EXIT_SECONDS:
            engine.close()
            os._exit(0)


@app.on_event("startup")
def _startup():
    db.reset_running_experiments()
    threading.Thread(target=_watchdog, daemon=True).start()


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-store"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")
