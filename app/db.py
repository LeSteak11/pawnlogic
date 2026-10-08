"""SQLite storage: games table is the single source of truth (PGN is generated on export)."""
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .paths import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('assisted','independent','experiment')),
  opponent TEXT NOT NULL DEFAULT '',
  my_color TEXT CHECK (my_color IN ('white','black')),
  result TEXT NOT NULL CHECK (result IN ('1-0','0-1','1/2-1/2','*')),
  start_fen TEXT NOT NULL,
  pgn TEXT NOT NULL,
  plies INTEGER NOT NULL,
  engine_label TEXT,
  engine_config TEXT,
  experiment_id TEXT,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  total_games INTEGER NOT NULL,
  max_plies INTEGER NOT NULL,
  config_a TEXT NOT NULL,
  config_b TEXT NOT NULL,
  label_a TEXT NOT NULL,
  label_b TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stopped',  -- running | stopped | done | error
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_games_exp ON games(experiment_id);
CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_source ON games(source);
CREATE INDEX IF NOT EXISTS idx_games_opponent ON games(opponent);
"""

# Outcome from the user's perspective; NULL when unscorable (no color, unfinished, experiment).
OUTCOME = """CASE
  WHEN source = 'experiment' OR my_color IS NULL OR result = '*' THEN NULL
  WHEN result = '1/2-1/2' THEN 'draw'
  WHEN (my_color = 'white' AND result = '1-0') OR (my_color = 'black' AND result = '0-1') THEN 'win'
  ELSE 'loss' END"""

_local = threading.local()


def conn() -> sqlite3.Connection:
    c = getattr(_local, "c", None)
    if c is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(DB_PATH)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)
        have = {r[1] for r in c.execute("PRAGMA table_info(games)")}
        for col in ("site", "ended", "updated_at"):  # added later: where it was played, how it ended, last auto-save
            if col not in have:
                c.execute(f"ALTER TABLE games ADD COLUMN {col} TEXT")
        _local.c = c
    return c


def upsert_game(gid, **g) -> str:
    """Update a game in place (auto-save as moves come in); insert it if the id is unknown."""
    if gid and conn().execute("SELECT 1 FROM games WHERE id = ?", (gid,)).fetchone():
        conn().execute(
            """UPDATE games SET opponent=?, my_color=?, result=?, start_fen=?, pgn=?, plies=?, engine_label=?,
               engine_config=?, notes=?, site=?, ended=?, updated_at=? WHERE id=?""",
            (g.get("opponent", ""), g.get("my_color"), g["result"], g["start_fen"], g["pgn"], g["plies"],
             g.get("engine_label"), json.dumps(g["engine_config"]) if g.get("engine_config") else None,
             g.get("notes", ""), g.get("site"), g.get("ended"), datetime.now(timezone.utc).isoformat(timespec="seconds"), gid))
        conn().commit()
        return gid
    return add_game(**g)


def add_game(**g) -> str:
    gid = uuid.uuid4().hex[:12]
    conn().execute(
        """INSERT INTO games (id, created_at, source, opponent, my_color, result, start_fen, pgn, plies,
           engine_label, engine_config, experiment_id, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (gid, datetime.now(timezone.utc).isoformat(timespec="seconds"), g["source"], g.get("opponent", ""),
         g.get("my_color"), g["result"], g["start_fen"], g["pgn"], g["plies"], g.get("engine_label"),
         json.dumps(g["engine_config"]) if g.get("engine_config") else None, g.get("experiment_id"),
         g.get("notes", "")),
    )
    if g.get("site") or g.get("ended"):
        conn().execute("UPDATE games SET site=?, ended=?, updated_at=created_at WHERE id=?", (g.get("site"), g.get("ended"), gid))
    conn().commit()
    return gid


LIST_COLS = f"id, created_at, source, site, ended, opponent, my_color, result, plies, engine_label, experiment_id, notes, json_extract(engine_config, '$.white') AS exp_white, ({OUTCOME}) AS outcome"


def list_games(q="", source="", limit=50, offset=0, experiment=""):
    where, args = [], []
    if experiment:
        where.append("experiment_id = ?")
        args.append(experiment)
    if source:
        where.append("source = ?")
        args.append(source)
    for term in q.split():
        where.append("(opponent LIKE ? OR notes LIKE ? OR engine_label LIKE ? OR created_at LIKE ? OR result LIKE ?)")
        args += [f"%{term}%"] * 5
    w = ("WHERE " + " AND ".join(where)) if where else ""
    rows = conn().execute(
        f"SELECT {LIST_COLS} FROM games {w} ORDER BY created_at DESC LIMIT ? OFFSET ?", (*args, limit, offset)
    ).fetchall()
    total = conn().execute(f"SELECT COUNT(*) FROM games {w}", args).fetchone()[0]
    return [dict(r) for r in rows], total


def get_game(gid):
    r = conn().execute("SELECT * FROM games WHERE id = ?", (gid,)).fetchone()
    return dict(r) if r else None


def set_result(gid, result, pgn, ended):
    conn().execute("UPDATE games SET result=?, pgn=?, ended=?, updated_at=? WHERE id=?",
                   (result, pgn, ended, datetime.now(timezone.utc).isoformat(timespec="seconds"), gid))
    conn().commit()


def delete_game(gid):
    c = conn().execute("DELETE FROM games WHERE id = ?", (gid,))
    conn().commit()
    return c.rowcount > 0


def all_pgns():
    return [r[0] for r in conn().execute("SELECT pgn FROM games ORDER BY created_at")]


def backup_to(path: Path):
    dst = sqlite3.connect(path)
    conn().backup(dst)
    dst.close()


def stats(source=""):
    f, args = ("WHERE source = ?", [source]) if source else ("", [])
    base = f"(SELECT *, ({OUTCOME}) AS o FROM games {f})"

    def grouped(expr, limit=15):
        rows = conn().execute(
            f"""SELECT {expr} AS k, COUNT(*) AS n, COALESCE(SUM(o='win'),0) AS w,
                COALESCE(SUM(o='loss'),0) AS l, COALESCE(SUM(o='draw'),0) AS d
                FROM {base} GROUP BY k ORDER BY n DESC LIMIT {limit}""", args).fetchall()
        return [dict(r) for r in rows]

    t = conn().execute(
        f"""SELECT COUNT(*) AS games, COALESCE(SUM(o='win'),0) AS wins, COALESCE(SUM(o='loss'),0) AS losses,
            COALESCE(SUM(o='draw'),0) AS draws FROM {base}""", args).fetchone()
    totals = dict(t)
    scored = totals["wins"] + totals["losses"] + totals["draws"]
    totals["scored"] = scored
    totals["win_pct"] = round(100 * totals["wins"] / scored, 1) if scored else None
    by_source = {r["source"]: r["n"] for r in conn().execute("SELECT source, COUNT(*) n FROM games GROUP BY source")}
    trend = [r[0] for r in conn().execute(
        f"SELECT o FROM {base} WHERE o IS NOT NULL ORDER BY created_at DESC LIMIT 200", args)][::-1]
    recent = conn().execute(
        f"SELECT {LIST_COLS} FROM games {f} ORDER BY created_at DESC LIMIT 10", args).fetchall()
    return {
        "totals": totals,
        "by_source": by_source,
        "by_opponent": grouped("CASE WHEN opponent = '' THEN '(unnamed)' ELSE opponent END"),
        "by_color": grouped("COALESCE(my_color, '(n/a)')"),
        "by_engine": grouped("COALESCE(engine_label, '(no engine)')"),
        "trend": trend,
        "recent": [dict(r) for r in recent],
    }


def opponents():
    return [r[0] for r in conn().execute(
        "SELECT opponent FROM games WHERE opponent <> '' GROUP BY opponent ORDER BY MAX(created_at) DESC LIMIT 30")]


# ---------- experiments ----------
def create_experiment(name, total, max_plies, ca, cb, la, lb):
    eid = uuid.uuid4().hex[:10]
    conn().execute(
        "INSERT INTO experiments (id, created_at, name, total_games, max_plies, config_a, config_b, label_a, label_b, status)"
        " VALUES (?,?,?,?,?,?,?,?,?, 'stopped')",
        (eid, datetime.now(timezone.utc).isoformat(timespec="seconds"), name, total, max_plies,
         json.dumps(ca), json.dumps(cb), la, lb))
    conn().commit()
    return eid


def set_experiment(eid, **fields):
    cols = ", ".join(f"{k} = ?" for k in fields)
    conn().execute(f"UPDATE experiments SET {cols} WHERE id = ?", (*fields.values(), eid))
    conn().commit()


def _tally(eid):
    """Results from A's perspective, plus color split, from the games table."""
    t = {"a_wins": 0, "b_wins": 0, "draws": 0, "white_wins": 0, "black_wins": 0, "games": 0, "plies": 0}
    for r in conn().execute(
        """SELECT result, json_extract(engine_config, '$.white') AS w, COUNT(*) n, SUM(plies) p
           FROM games WHERE experiment_id = ? AND result <> '*' GROUP BY result, w""", (eid,)):
        n = r["n"]
        t["games"] += n
        t["plies"] += r["p"] or 0
        if r["result"] == "1/2-1/2":
            t["draws"] += n
        else:
            t["white_wins" if r["result"] == "1-0" else "black_wins"] += n
            a_won = (r["result"] == "1-0") == (r["w"] == "A")
            t["a_wins" if a_won else "b_wins"] += n
    return t


def _exp_row(r):
    d = dict(r)
    d["config_a"], d["config_b"] = json.loads(d["config_a"]), json.loads(d["config_b"])
    d["tally"] = _tally(d["id"])
    return d


def list_experiments():
    return [_exp_row(r) for r in conn().execute("SELECT * FROM experiments ORDER BY created_at DESC")]


def get_experiment(eid):
    r = conn().execute("SELECT * FROM experiments WHERE id = ?", (eid,)).fetchone()
    return _exp_row(r) if r else None


def delete_experiment(eid):
    conn().execute("DELETE FROM games WHERE experiment_id = ?", (eid,))
    conn().execute("DELETE FROM experiments WHERE id = ?", (eid,))
    conn().commit()


def count_experiment_games(eid):
    return conn().execute("SELECT COUNT(*) FROM games WHERE experiment_id = ?", (eid,)).fetchone()[0]


def reset_running_experiments():
    """Startup: a 'running' row with no live thread means the app was closed mid-run."""
    conn().execute("UPDATE experiments SET status = 'stopped' WHERE status = 'running'")
    conn().commit()
