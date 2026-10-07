"""Chess Lab local server: JSON API + static UI."""
import io
import os
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
    try:
        return engine.analyse(b, load_config())
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


@app.post("/api/games")
def save_game(body: dict = Body(...)):
    b = make_board(body["start_fen"])
    game = chess.pgn.Game()
    game.setup(b)
    node = game
    for u in body["ucis"]:
        mv = chess.Move.from_uci(u)
        if mv not in b.legal_moves:
            bad(f"Illegal move {u}")
        node = node.add_variation(mv)
        b.push(mv)
    my_color = body.get("my_color") or None
    source = body.get("source", "assisted")
    choice = body.get("result", "auto")
    if choice == "auto":
        result = b.result() if b.is_game_over() else bad("Game isn't over: pick a result")
    elif choice in ("win", "loss"):
        if not my_color:
            bad("Pick your color to record a win/loss")
        result = "1-0" if (choice == "win") == (my_color == "white") else "0-1"
    elif choice in RESULT_FROM_CHOICE:
        result = RESULT_FROM_CHOICE[choice]
    else:
        bad("Unknown result")
    opp = (body.get("opponent") or "").strip()
    me = "Me"
    now = datetime.now()
    game.headers.update({
        "Event": "Chess Lab", "Site": "Chess Lab", "Date": now.strftime("%Y.%m.%d"),
        "White": me if my_color == "white" else (opp or "?"),
        "Black": me if my_color == "black" else (opp or "?"),
        "Result": result,
    })
    cfg = load_config() if source == "assisted" else None
    gid = db.add_game(
        source=source, opponent=opp, my_color=my_color, result=result, start_fen=body["start_fen"],
        pgn=str(game), plies=len(body["ucis"]), notes=(body.get("notes") or "").strip(),
        engine_label=config_label(cfg) if cfg else None, engine_config=cfg)
    return {"id": gid, "result": result}


@app.get("/api/games")
def games(q: str = "", source: str = "", limit: int = 50, offset: int = 0):
    rows, total = db.list_games(q, source, min(limit, 200), offset)
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


def _watchdog():
    while True:
        time.sleep(10)
        if time.time() - _last_ping > IDLE_EXIT_SECONDS:
            engine.close()
            os._exit(0)


@app.on_event("startup")
def _startup():
    threading.Thread(target=_watchdog, daemon=True).start()


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-store"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")
