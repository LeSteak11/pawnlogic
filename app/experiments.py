"""Engine-vs-engine experiments. One experiment runs at a time on a background thread; each finished game is
saved immediately, so stop/crash/close never loses more than the game in progress."""
import math
import random
import threading
from datetime import datetime

import chess
import chess.pgn

from . import db
from .engine import config_label, load_config, open_uci, search_limit

# Short, balanced openings. Each opening is played twice with colors swapped (fair pairs), in a per-experiment shuffle.
OPENINGS = [
    "e4 e5 Nf3 Nc6", "e4 e5 Nf3 Nc6 Bb5 a6", "e4 e5 Nf3 Nc6 Bc4 Bc5", "e4 c5 Nf3 d6", "e4 c5 Nf3 Nc6",
    "e4 e6 d4 d5", "e4 c6 d4 d5", "e4 d5 exd5 Qxd5", "d4 d5 c4 e6", "d4 d5 c4 c6", "d4 Nf6 c4 e6",
    "d4 Nf6 c4 g6", "d4 Nf6 Nf3 g6", "c4 e5 Nc3 Nf6", "c4 c5 Nf3 Nf6", "Nf3 d5 g3 Nf6", "Nf3 Nf6 c4 e6",
    "e4 e5 Nf3 Nf6 Nxe5 d6", "e4 e5 Nc3 Nf6", "d4 Nf6 Bg5 Ne4", "e4 Nf6 e5 Nd5", "e4 d6 d4 Nf6 Nc3 g6",
    "d4 e6 e4 d5", "e4 e5 f4 exf4",
]


def elo_estimate(wins, draws, losses):
    """Elo difference of A over B with a 95% interval. None until there are enough games to mean anything."""
    n = wins + draws + losses
    if n < 20:
        return None
    s = (wins + draws / 2) / n
    if s <= 0 or s >= 1:
        return {"elo": None, "margin": None, "note": "Clean sweep: difference too large to estimate"}
    var = (wins * (1 - s) ** 2 + draws * (0.5 - s) ** 2 + losses * s ** 2) / n
    se = math.sqrt(var / n)

    def elo(x):
        return -400 * math.log10(1 / x - 1)
    lo, hi = max(s - 1.96 * se, 1e-6), min(s + 1.96 * se, 1 - 1e-6)
    return {"elo": round(elo(s)), "margin": round((elo(hi) - elo(lo)) / 2)}


class Runner:
    def __init__(self):
        self.thread = None
        self.stop_flag = threading.Event()
        self.live = {}

    @property
    def running(self):
        return self.thread is not None and self.thread.is_alive()

    def start(self, eid):
        if self.running:
            raise RuntimeError("Another experiment is already running")
        self.stop_flag.clear()
        db.set_experiment(eid, status="running", note="")
        self.live = {"id": eid, "fen": chess.STARTING_FEN, "last": None, "game_no": 0, "white": "A", "ply": 0}
        self.thread = threading.Thread(target=self._run, args=(eid,), daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_flag.set()

    def _play_game(self, engines, exp, idx):
        white = "A" if idx % 2 == 0 else "B"
        order = list(OPENINGS)
        random.Random(exp["id"]).shuffle(order)
        board = chess.Board()
        for san in order[(idx // 2) % len(order)].split():
            board.push_san(san)
        start_plies = len(board.move_stack)
        cfgs = {"A": exp["config_a"], "B": exp["config_b"]}
        self.live.update({"game_no": idx + 1, "white": white, "fen": board.fen(), "last": None, "ply": start_plies})
        while True:
            outcome = board.outcome(claim_draw=True)
            if outcome:
                termination = outcome.termination.name.replace("_", " ").lower()
                result = outcome.result()
                break
            if len(board.move_stack) - start_plies >= exp["max_plies"]:
                result, termination = "1/2-1/2", "adjudicated draw (move cap)"
                break
            if self.stop_flag.is_set():
                return None  # the unfinished game is discarded
            key = white if board.turn else ("B" if white == "A" else "A")
            mv = engines[key].play(board, search_limit(cfgs[key])).move
            board.push(mv)
            self.live.update({"fen": board.fen(), "last": mv.uci(), "ply": len(board.move_stack)})
        game = chess.pgn.Game.from_board(board)
        names = {"A": f"A: {exp['label_a']}", "B": f"B: {exp['label_b']}"}
        game.headers.update({
            "Event": exp["name"], "Site": "Chess Lab", "Date": datetime.now().strftime("%Y.%m.%d"), "Round": str(idx + 1),
            "White": names[white], "Black": names["B" if white == "A" else "A"], "Result": result, "Termination": termination})
        db.add_game(
            source="experiment", opponent=exp["name"], my_color=None, result=result, start_fen=chess.STARTING_FEN,
            pgn=str(game), plies=len(board.move_stack), experiment_id=exp["id"],
            engine_label=f"A: {exp['label_a']} | B: {exp['label_b']}",
            engine_config={"A": exp["config_a"], "B": exp["config_b"], "white": white}, notes=f"Game {idx + 1}")
        return result

    def _run(self, eid):
        engines, status, note = {}, "done", ""
        try:
            exp = db.get_experiment(eid)
            engines = {"A": open_uci(exp["config_a"]), "B": open_uci(exp["config_b"])}
            for idx in range(db.count_experiment_games(eid), exp["total_games"]):
                if self._play_game(engines, exp, idx) is None:
                    status = "stopped"
                    break
        except Exception as e:
            status, note = "error", str(e)
        finally:
            for e in engines.values():
                try:
                    e.quit()
                except Exception:
                    pass
            db.set_experiment(eid, status=status, note=note)


runner = Runner()


def sanitize(cfg: dict) -> dict:
    """Merge a UI-supplied side config over the app defaults and validate ranges."""
    base = load_config()
    c = {k: base[k] for k in ("path", "mode", "time_ms", "depth", "threads", "hash_mb", "skill_level", "elo")}
    c.update({k: v for k, v in cfg.items() if k in c})
    c["mode"] = "depth" if c["mode"] == "depth" else "time"
    c["time_ms"] = max(10, int(c["time_ms"] or 100))
    c["depth"] = max(1, min(40, int(c["depth"] or 8)))
    c["threads"] = max(1, min(32, int(c["threads"] or 1)))
    c["hash_mb"] = max(16, int(c["hash_mb"] or 64))
    c["skill_level"] = max(0, min(20, int(c["skill_level"] if c["skill_level"] is not None else 20)))
    c["elo"] = max(1320, min(3190, int(c["elo"]))) if c.get("elo") else None
    return c


def label_for(cfg):
    return config_label(cfg)
