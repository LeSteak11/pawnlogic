"""CPU engine layer: human-like Maia-3 recommendations plus Stockfish support."""
import json
import math
import os
import random
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
    "maia_recommendation": "likely",
    "maia_temperature": 0.2,
    "maia_top_p": 0.95,
    "path": "engine/stockfish.exe",
    "mode": "time",       # "time" (ms per move) or "depth"
    "time_ms": 1000,
    "depth": 18,
    "nodes": 250000,
    "multipv": 3,
    "continuation_moves": 2,
    "threads": 4,
    "hash_mb": 256,
    "skill_level": 20,    # 0-20; 20 = full strength
    "elo": None,          # 1320-3190 limits strength when set
    "stockfish_variety": "best",
    "stockfish_max_loss_cp": 80,
    "stockfish_variety_temperature": 35,
    "hybrid_guard": True,
}

MAIA_CHECKPOINTS = {
    "5m": ("UofTCSSLab/Maia3-5M", "maia3-5m.pt"),
    "23m": ("UofTCSSLab/Maia3-23M", "maia3-23m.pt"),
    "79m": ("UofTCSSLab/Maia3-79M", "maia3-79m.pt"),
}


def maia_cache_status() -> dict[str, bool]:
    """Reports whether each official checkpoint is already in the default HF cache."""
    try:
        from huggingface_hub import try_to_load_from_cache
        return {name: isinstance(try_to_load_from_cache(repo, filename), str)
                for name, (repo, filename) in MAIA_CHECKPOINTS.items()}
    except (ImportError, OSError):
        return {name: False for name in MAIA_CHECKPOINTS}


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
    if cfg["maia_recommendation"] not in {"likely", "natural", "custom"}:
        raise ValueError("Unknown Maia recommendation mode")
    cfg["maia_elo"] = max(0, min(5000, int(cfg["maia_elo"])))
    cfg["maia_opponent_elo"] = max(0, min(5000, int(cfg["maia_opponent_elo"])))
    cfg["maia_temperature"] = max(0.0, min(5.0, float(cfg["maia_temperature"])))
    cfg["maia_top_p"] = max(0.01, min(1.0, float(cfg["maia_top_p"])))
    if cfg["mode"] not in {"time", "depth", "nodes"}:
        raise ValueError("Calculation limit must be time, depth, or nodes")
    cfg["time_ms"] = max(50, min(60000, int(cfg["time_ms"])))
    cfg["depth"] = max(1, min(60, int(cfg["depth"])))
    cfg["nodes"] = max(1, min(1000000000, int(cfg["nodes"])))
    cfg["multipv"] = max(1, min(8, int(cfg["multipv"])))
    cfg["continuation_moves"] = max(0, min(6, int(cfg["continuation_moves"])))
    cfg["threads"] = max(1, min(32, int(cfg["threads"])))
    cfg["hash_mb"] = max(16, min(65536, int(cfg["hash_mb"])))
    cfg["skill_level"] = max(0, min(20, int(cfg["skill_level"])))
    cfg["elo"] = max(1320, min(3190, int(cfg["elo"]))) if cfg.get("elo") else None
    if cfg["stockfish_variety"] not in {"best", "bounded"}:
        raise ValueError("Unknown Stockfish recommendation mode")
    cfg["stockfish_max_loss_cp"] = max(0, min(500, int(cfg["stockfish_max_loss_cp"])))
    cfg["stockfish_variety_temperature"] = max(1, min(500, int(cfg["stockfish_variety_temperature"])))
    cfg["hybrid_guard"] = bool(cfg["hybrid_guard"])
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    return cfg


def config_label(cfg: dict) -> str:
    if cfg.get("engine") == "maia3":
        behavior = {"likely": "most likely", "natural": "natural sample", "custom": "custom sample"}.get(
            cfg.get("maia_recommendation"), "most likely")
        return f"Maia-3 {cfg.get('maia_model', '5m').upper()} · Elo {cfg.get('maia_elo', 1500)} · {behavior}"
    limit = (f"{cfg['time_ms']}ms" if cfg["mode"] == "time" else
             f"depth {cfg['depth']}" if cfg["mode"] == "depth" else f"{cfg['nodes']} nodes")
    strength = f"Elo {cfg['elo']}" if cfg.get("elo") else f"skill {cfg['skill_level']}"
    variety = " · bounded variety" if cfg.get("stockfish_variety") == "bounded" else ""
    return f"Stockfish · {limit} · {strength}{variety}"


def fmt_score(score: chess.engine.PovScore) -> dict:
    w = score.white()
    if w.is_mate():
        m = w.mate()
        return {"text": ("+" if m > 0 else "-") + f"M{abs(m)}", "cp": 10000 if m > 0 else -10000,
                "mate": m}
    cp = w.score()
    return {"text": f"{cp / 100:+.2f}", "cp": cp, "mate": None}


PIECE_VALUE = {
    chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
    chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0,
}


def candidate_traits(board: chess.Board, pv: list[chess.Move]) -> dict:
    """Return engine-independent facts used by the configurable play profiles."""
    move = pv[0]
    piece = board.piece_at(move.from_square)
    if piece is None:
        return {}
    mover = board.turn
    enemy_king = board.king(not mover)
    captured = board.piece_at(move.to_square)
    capture_value = PIECE_VALUE.get(captured.piece_type, 0) if captured else (1 if board.is_en_passant(move) else 0)
    from_file, from_rank = chess.square_file(move.from_square), chess.square_rank(move.from_square)
    to_file, to_rank = chess.square_file(move.to_square), chess.square_rank(move.to_square)
    home_rank = 0 if mover == chess.WHITE else 7
    forward = to_rank - from_rank if mover == chess.WHITE else from_rank - to_rank
    center_before = abs(from_file - 3.5) + abs(from_rank - 3.5)
    center_after = abs(to_file - 3.5) + abs(to_rank - 3.5)
    non_pawn_material = sum(
        len(board.pieces(kind, color)) * PIECE_VALUE[kind]
        for color in (chess.WHITE, chess.BLACK)
        for kind in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
    )
    after = board.copy(stack=False)
    after.push(move)
    gives_check = after.is_check()
    enemy_distance_before = (
        chess.square_distance(move.from_square, enemy_king) if enemy_king is not None else 8
    )
    enemy_distance_after = (
        chess.square_distance(move.to_square, enemy_king) if enemy_king is not None else 8
    )
    reply_capture = False
    queen_trade = bool(captured and captured.piece_type == chess.QUEEN)
    if len(pv) > 1 and pv[1] in after.legal_moves:
        reply = pv[1]
        reply_capture = after.is_capture(reply) and reply.to_square == move.to_square
        reply_target = after.piece_at(reply.to_square)
        queen_trade = queen_trade or bool(reply_target and reply_target.piece_type == chess.QUEEN)
    passed_pawn = False
    if piece.piece_type == chess.PAWN:
        enemy_pawns = after.pieces(chess.PAWN, not mover)
        direction = range(to_rank + 1, 8) if mover == chess.WHITE else range(to_rank - 1, -1, -1)
        passed_pawn = not any(
            chess.square(file_no, rank_no) in enemy_pawns
            for file_no in range(max(0, to_file - 1), min(7, to_file + 1) + 1)
            for rank_no in direction
        )
    return {
        "check": gives_check,
        "capture": board.is_capture(move),
        "captureValue": capture_value,
        "castle": board.is_castling(move),
        "promotion": bool(move.promotion),
        "develop": piece.piece_type in (chess.KNIGHT, chess.BISHOP) and from_rank == home_rank,
        "retreat": forward < 0 and piece.piece_type != chess.PAWN,
        "advance": max(0, forward),
        "center": max(0.0, center_before - center_after),
        "activity": max(-2.0, min(2.0, center_before - center_after)),
        "kingPressure": max(0, enemy_distance_before - enemy_distance_after),
        "kingMove": piece.piece_type == chess.KING and not board.is_castling(move),
        "trade": reply_capture,
        "queenTrade": queen_trade,
        "quiet": not board.is_capture(move) and not gives_check and not move.promotion,
        "forcing": gives_check or board.is_capture(move) or bool(move.promotion),
        "passedPawn": passed_pawn,
        "endgame": non_pawn_material <= 26,
    }


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
    if cfg["mode"] == "time":
        return chess.engine.Limit(time=cfg["time_ms"] / 1000)
    if cfg["mode"] == "nodes":
        return chess.engine.Limit(nodes=int(cfg["nodes"]))
    return chess.engine.Limit(depth=int(cfg["depth"]))


def bounded_stockfish_choice(board: chess.Board, candidates: list[dict], cfg: dict, rng=random) -> tuple[str | None, int]:
    """Samples a searched move without allowing more than the configured evaluation loss."""
    if not candidates:
        return None, 0
    sign = 1 if board.turn == chess.WHITE else -1
    values = [sign * int(c["score"]["cp"]) for c in candidates]
    best = max(values)
    losses = [max(0, best - value) for value in values]
    ceiling = int(cfg.get("stockfish_max_loss_cp", 80))
    eligible = [(candidate, loss) for candidate, loss in zip(candidates, losses) if loss <= ceiling]
    temperature = max(1, int(cfg.get("stockfish_variety_temperature", 35)))
    weights = [math.exp(-loss / temperature) for _, loss in eligible]
    candidate, loss = rng.choices(eligible, weights=weights, k=1)[0]
    return candidate["uci"], loss


def forced_finish_choice(board: chess.Board, candidates: list[dict]) -> tuple[str | None, str | None]:
    """Choose immediate/shortest mate before any stylistic recommendation policy."""
    scored = []
    for index, candidate in enumerate(candidates):
        try:
            move = chess.Move.from_uci(candidate["uci"])
        except (KeyError, ValueError):
            continue
        if move not in board.legal_moves:
            continue
        after = board.copy(stack=False)
        after.push(move)
        if after.is_checkmate():
            return candidate["uci"], "Immediate checkmate"
        score = candidate.get("quality_score") or candidate.get("score") or {}
        mate = score.get("mate")
        if mate is not None:
            scored.append((index, candidate["uci"], mate if board.turn == chess.WHITE else -mate))
    winning = [item for item in scored if item[2] > 0]
    if winning:
        _, uci, mate = min(winning, key=lambda item: (item[2], item[0]))
        return uci, f"Shortest proven mate · M{mate}"
    if scored and len(scored) == len(candidates) and all(item[2] < 0 for item in scored):
        _, uci, mate = max(scored, key=lambda item: (abs(item[2]), -item[0]))
        return uci, f"Longest resistance · M{abs(mate)}"
    return None, None


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
        self.eval_cache = {}  # restricted root-move evaluations used by the Maia safety guard
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
                    display_count = int(cfg["multipv"])
                    multipv = display_count
                    weakened = bool(cfg.get("elo")) or int(cfg.get("skill_level", 20)) < 20
                    if self.engine_name == "stockfish" and (cfg.get("stockfish_variety") == "bounded" or weakened):
                        multipv = max(5, multipv)
                    elif self.engine_name == "maia3" and cfg.get("maia_recommendation") in {"natural", "custom"}:
                        # Maia can sample below its displayed top moves. Ask for its
                        # widest supported candidate set so the sampled move can be
                        # shown with the model's corresponding outcome estimate.
                        multipv = 20
                    with self.proc.analysis(board, limit, multipv=multipv) as an:
                        for _ in an:
                            if mine != self.gen:
                                an.stop()
                                break
                        infos = list(an.multipv)
                        played = an.wait().move
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
            pv_plies = 1 + 2 * int(cfg.get("continuation_moves", 2))
            for mv in pv[:pv_plies]:
                sans.append(b.san(mv))
                b.push(mv)
            cands.append({"uci": pv[0].uci(), "san": sans[0], "pv": sans, "score": fmt_score(info["score"]),
                          "depth": info.get("depth", 0), "traits": candidate_traits(board, pv)})
        recommended, detail = self.recommendation(board, cands, played, cfg)
        if recommended and all(candidate["uci"] != recommended for candidate in cands):
            try:
                move = chess.Move.from_uci(recommended)
                if move in board.legal_moves:
                    san = board.san(move)
                    cands.append({"uci": recommended, "san": san, "pv": [san], "score": None, "depth": 0,
                                  "traits": candidate_traits(board, [move])})
            except ValueError:
                pass
        shown = cands[:display_count]
        if recommended and all(candidate["uci"] != recommended for candidate in shown):
            sampled = next((candidate for candidate in cands if candidate["uci"] == recommended), None)
            if sampled is not None:
                shown = ([*shown[:-1], sampled] if shown else [sampled])
        res = {"engine": self.engine_name, "candidates": shown,
               "depth": max((c["depth"] for c in shown), default=0)}
        res.update({"recommended_uci": recommended, "recommendation_mode": detail})
        if len(self.cache) > 500:
            self.cache.clear()
        self.cache[ckey] = res
        return res

    def recommendation(self, board, candidates, played, cfg):
        if cfg.get("stockfish_variety") == "bounded":
            uci, loss = bounded_stockfish_choice(board, candidates, cfg)
            return uci, f"bounded:{loss}"
        # At reduced strength Stockfish's UCI bestmove contains its native randomized
        # weaker choice. At full strength the first searched line is the exact best.
        weakened = bool(cfg.get("elo")) or int(cfg.get("skill_level", 20)) < 20
        played_uci = played.uci() if played else None
        if weakened and played_uci:
            return played_uci, "configured-strength"
        return (candidates[0]["uci"] if candidates else played_uci), "best"

    def search_limit(self, cfg):
        return search_limit(cfg)

    def evaluate_candidates(self, board, candidates, cfg):
        """Evaluate a supplied root-move set at full strength in one local Stockfish search."""
        moves = []
        for candidate in candidates:
            try:
                move = chess.Move.from_uci(candidate["uci"])
            except (KeyError, ValueError):
                continue
            if move in board.legal_moves and move not in moves:
                moves.append(move)
        if not moves:
            return candidates

        guard_cfg = {**cfg, "elo": None, "skill_level": 20}
        pv_plies = 1 + 2 * int(guard_cfg.get("continuation_moves", 2))
        eval_key = (board.fen(), tuple(move.uci() for move in moves), guard_cfg["mode"],
                    guard_cfg["time_ms"], guard_cfg["depth"], guard_cfg["nodes"],
                    guard_cfg["threads"], guard_cfg["hash_mb"], pv_plies)
        evaluated = self.eval_cache.get(eval_key)
        if evaluated is None:
            with self.lock:
                self._ensure(guard_cfg)
                infos = self.proc.analyse(
                    board,
                    search_limit(guard_cfg),
                    multipv=len(moves),
                    root_moves=moves,
                )
            if isinstance(infos, dict):
                infos = [infos]
            evaluated = {}
            for info in infos:
                pv = info.get("pv") or []
                if not pv or "score" not in info:
                    continue
                line_board, sans = board.copy(), []
                for move in pv[:pv_plies]:
                    sans.append(line_board.san(move))
                    line_board.push(move)
                evaluated[pv[0].uci()] = {
                    "score": fmt_score(info["score"]),
                    "depth": info.get("depth", 0),
                    "pv": sans,
                }
            if len(self.eval_cache) > 500:
                self.eval_cache.clear()
            self.eval_cache[eval_key] = evaluated
        for candidate in candidates:
            item = evaluated.get(candidate.get("uci"))
            if item:
                candidate["quality_score"] = item["score"]
                candidate["quality_depth"] = item["depth"]
                candidate["pv"] = item["pv"]
        return candidates


def maia_command(cfg: dict) -> list[str]:
    if getattr(sys, "frozen", False):
        launcher = [str(Path(sys.executable).with_name("Maia3UCI.exe"))]
    else:
        launcher = [sys.executable, str(SOURCE_ROOT / "run.py"), "--maia3-uci"]
    launcher.extend(["--model", f"maia3-{cfg.get('maia_model', '5m')}",
                     "--device", "cpu", "--no-use-amp", "--use-uci-history"])
    return launcher


def maia_options(cfg: dict) -> dict:
    behavior = cfg.get("maia_recommendation", "likely")
    temperature = 0.0 if behavior == "likely" else 1.0 if behavior == "natural" else float(cfg.get("maia_temperature", 0.2))
    top_p = 1.0 if behavior == "likely" else 0.95 if behavior == "natural" else float(cfg.get("maia_top_p", 0.95))
    return {
        "SelfElo": int(cfg.get("maia_elo", 1500)),
        "OppoElo": int(cfg.get("maia_opponent_elo", 1500)),
        "Temperature": str(temperature),
        "TopP": str(top_p),
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

    def recommendation(self, board, candidates, played, cfg):
        if cfg.get("maia_recommendation", "likely") == "likely":
            return (candidates[0]["uci"] if candidates else None), "most-likely"
        played_uci = played.uci() if played else None
        return (played_uci or (candidates[0]["uci"] if candidates else None)), "sampled"

    def analyse(self, board, cfg):
        result = super().analyse(board, cfg)
        if not result.get("superseded"):
            result = {**result, "model": cfg.get("maia_model", "5m"),
                      "elo": int(cfg.get("maia_elo", 1500))}
        return result


ENGINES = {"maia3": Maia3Engine, "stockfish": StockfishEngine}
