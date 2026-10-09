"""CPU engine layer: human-like Maia-3 recommendations plus Stockfish support."""
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

import chess
import chess.engine

from .paths import CONFIG_PATH, RESOURCE_ROOT, SOURCE_ROOT

DEFAULT_CONFIG = {
    "config_version": 2,
    "engine": "maia3",
    "maia_model": "5m",
    "maia_elo": 1500,
    "maia_opponent_elo": 1500,
    "maia_temperature": 0.2,
    "maia_top_p": 0.95,
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
        stored = json.loads(CONFIG_PATH.read_text())
        # Engine selection was not user-facing before v2, so old "stockfish"
        # values represent the former default rather than an explicit choice.
        if stored.get("config_version", 1) < 2 and stored.get("engine") == "stockfish":
            stored["engine"] = "maia3"
        cfg.update(stored)
    except (OSError, ValueError):
        pass
    return cfg


def save_config(patch: dict) -> dict:
    cfg = load_config()
    for k in DEFAULT_CONFIG:
        if k in patch:
            cfg[k] = patch[k]
    if cfg["engine"] not in ENGINES:
        raise ValueError(f"Unknown engine: {cfg['engine']}")
    if cfg["maia_model"] not in {"5m", "23m", "79m"}:
        raise ValueError("Maia model must be 5m, 23m, or 79m")
    cfg["maia_elo"] = max(0, min(5000, int(cfg["maia_elo"])))
    cfg["maia_opponent_elo"] = max(0, min(5000, int(cfg["maia_opponent_elo"])))
    cfg["maia_temperature"] = max(0.0, min(5.0, float(cfg["maia_temperature"])))
    cfg["maia_top_p"] = max(0.01, min(1.0, float(cfg["maia_top_p"])))
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    return cfg


def config_label(cfg: dict) -> str:
    if cfg.get("engine") == "maia3":
        return f"Maia-3 {cfg.get('maia_model', '5m').upper()} · Elo {cfg.get('maia_elo', 1500)} · human policy"
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
    engine_name = "stockfish"

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
            limit = self.search_limit(cfg)
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
        res = {"engine": self.engine_name, "candidates": cands,
               "depth": max((c["depth"] for c in cands), default=0)}
        if len(self.cache) > 500:
            self.cache.clear()
        self.cache[ckey] = res
        return res

    def search_limit(self, cfg):
        return search_limit(cfg)


def maia_command(cfg: dict) -> list[str]:
    if getattr(sys, "frozen", False):
        launcher = [str(Path(sys.executable).with_name("Maia3UCI.exe"))]
    else:
        launcher = [sys.executable, str(SOURCE_ROOT / "run.py"), "--maia3-uci"]
    launcher.extend(["--model", f"maia3-{cfg.get('maia_model', '5m')}",
                     "--device", "cpu", "--no-use-amp", "--use-uci-history"])
    return launcher


def maia_options(cfg: dict) -> dict:
    return {
        "SelfElo": int(cfg.get("maia_elo", 1500)),
        "OppoElo": int(cfg.get("maia_opponent_elo", 1500)),
        "Temperature": str(float(cfg.get("maia_temperature", 0.2))),
        "TopP": str(float(cfg.get("maia_top_p", 0.95))),
    }


class Maia3Engine(StockfishEngine):
    """Official Maia-3 UCI model, forced to its CPU backend."""

    engine_name = "maia3"

    def _ensure(self, cfg):
        command, options = maia_command(cfg), maia_options(cfg)
        key = (tuple(command), json.dumps(options, sort_keys=True))
        if self.proc is not None and key == self.opts_key:
            return
        self.close()
        try:
            self.proc = chess.engine.SimpleEngine.popen_uci(
                command, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                timeout=120,
            )
        except (FileNotFoundError, chess.engine.EngineError) as error:
            raise RuntimeError("Maia-3 is not installed. Re-run ChessLab.bat to install its CPU runtime.") from error
        self.proc.configure({k: v for k, v in options.items() if k in self.proc.options})
        self.opts_key = key

    def search_limit(self, cfg):
        return chess.engine.Limit(nodes=1)

    def analyse(self, board, cfg):
        result = super().analyse(board, cfg)
        if not result.get("superseded"):
            result = {**result, "model": cfg.get("maia_model", "5m"),
                      "elo": int(cfg.get("maia_elo", 1500))}
        return result


ENGINES = {"maia3": Maia3Engine, "stockfish": StockfishEngine}
