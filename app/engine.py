"""Engine layer. `Engine` is the interface the app uses; StockfishEngine is the only implementation for V1.
To add another engine/strategy later, subclass Engine and register it in ENGINES."""
import json
import threading
from pathlib import Path

import chess
import chess.engine

from .paths import CONFIG_PATH, RESOURCE_ROOT

DEFAULT_CONFIG = {
    "engine": "stockfish",
    "path": "engine/stockfish.exe",
    "mode": "time",       # "time" (ms per move) or "depth"
    "time_ms": 1000,
    "depth": 18,
    "multipv": 3,
    "threads": 4,
    "hash_mb": 256,
    "skill_level": 20,    # 0-20; 20 = full strength
    "elo": None,          # 1320-3190 limits strength when set
}


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    try:
        cfg.update(json.loads(CONFIG_PATH.read_text()))
    except (OSError, ValueError):
        pass
    return cfg


def save_config(patch: dict) -> dict:
    cfg = load_config()
    for k in DEFAULT_CONFIG:
        if k in patch:
            cfg[k] = patch[k]
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    return cfg


def config_label(cfg: dict) -> str:
    limit = f"{cfg['time_ms']}ms" if cfg["mode"] == "time" else f"depth {cfg['depth']}"
    strength = f"Elo {cfg['elo']}" if cfg.get("elo") else f"skill {cfg['skill_level']}"
    return f"Stockfish · {limit} · {strength}"


def fmt_score(score: chess.engine.PovScore) -> dict:
    w = score.white()
    if w.is_mate():
        m = w.mate()
        return {"text": ("+" if m > 0 else "-") + f"M{abs(m)}", "cp": 10000 if m > 0 else -10000}
    cp = w.score()
    return {"text": f"{cp / 100:+.2f}", "cp": cp}


def uci_options(cfg: dict) -> dict:
    o = {"Threads": int(cfg["threads"]), "Hash": int(cfg["hash_mb"])}
    if cfg.get("elo"):
        o.update({"UCI_LimitStrength": True, "UCI_Elo": int(cfg["elo"])})
    else:
        o.update({"UCI_LimitStrength": False, "Skill Level": int(cfg["skill_level"])})
    return o


def engine_path(cfg: dict) -> Path:
    p = Path(cfg["path"])
    return p if p.is_absolute() else RESOURCE_ROOT / p


def open_uci(cfg: dict) -> "chess.engine.SimpleEngine":
    path = engine_path(cfg)
    if not path.exists():
        raise RuntimeError(f"Stockfish not found at {path}. Put stockfish.exe in the engine/ folder.")
    import os
    import subprocess
    proc = chess.engine.SimpleEngine.popen_uci(str(path), creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    proc.configure({k: v for k, v in uci_options(cfg).items() if k in proc.options})
    return proc


def search_limit(cfg: dict) -> "chess.engine.Limit":
    return (chess.engine.Limit(time=cfg["time_ms"] / 1000) if cfg["mode"] == "time"
            else chess.engine.Limit(depth=int(cfg["depth"])))


class Engine:
    def analyse(self, board: chess.Board, cfg: dict) -> dict:
        raise NotImplementedError

    def close(self):
        pass


class StockfishEngine(Engine):
    def __init__(self):
        self.lock = threading.Lock()
        self.gen = 0          # newest request wins; older searches stop early
        self.proc = None
        self.opts_key = None
        self.cache = {}       # (fen, settings) -> result, so revisiting a position is instant
        self.inflight = {}    # (fen, settings) -> Event; a second request for the same position waits for it

    def _ensure(self, cfg):
        key = (str(engine_path(cfg)), json.dumps(uci_options(cfg), sort_keys=True))
        if self.proc is not None and key == self.opts_key:
            return
        self.close()
        self.proc = open_uci(cfg)
        self.opts_key = key

    def close(self):
        if self.proc is not None:
            try:
                self.proc.quit()
            except Exception:
                pass
            self.proc = None

    def analyse(self, board, cfg):
        ckey = (board.fen(), json.dumps(cfg, sort_keys=True))
        if ckey in self.cache:
            return self.cache[ckey]
        ev = self.inflight.get(ckey)
        if ev is not None:  # same position already being searched (another tab, a retry): share it, don't cancel it
            ev.wait(30)
            if ckey in self.cache:
                return self.cache[ckey]
        ev = self.inflight[ckey] = threading.Event()
        try:
            return self._search(board, cfg, ckey)
        finally:
            ev.set()
            if self.inflight.get(ckey) is ev:
                del self.inflight[ckey]

    def _search(self, board, cfg, ckey):
        self.gen += 1
        mine = self.gen
        with self.lock:
            if mine != self.gen:
                return {"superseded": True}
            if board.is_game_over():
                return {"candidates": [], "depth": 0}
            limit = search_limit(cfg)
            for attempt in (0, 1):
                try:
                    self._ensure(cfg)
                    with self.proc.analysis(board, limit, multipv=int(cfg["multipv"])) as an:
                        for _ in an:
                            if mine != self.gen:
                                an.stop()
                                break
                        infos = list(an.multipv)
                    break
                except (chess.engine.EngineTerminatedError, chess.engine.EngineError):
                    self.close()
                    if attempt:
                        raise
            if mine != self.gen:
                return {"superseded": True}
        cands = []
        for info in infos:
            pv = info.get("pv") or []
            if not pv:
                continue
            b, sans = board.copy(), []
            for mv in pv[:8]:
                sans.append(b.san(mv))
                b.push(mv)
            cands.append({"uci": pv[0].uci(), "san": sans[0], "pv": sans, "score": fmt_score(info["score"]),
                          "depth": info.get("depth", 0)})
        res = {"candidates": cands, "depth": max((c["depth"] for c in cands), default=0)}
        if len(self.cache) > 500:
            self.cache.clear()
        self.cache[ckey] = res
        return res


ENGINES = {"stockfish": StockfishEngine}
