"""Application resources and persistent user data."""
import os
import shutil
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

RESOURCE_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
SOURCE_ROOT = Path(__file__).resolve().parent.parent
USER_ROOT = Path(os.environ.get("CHESSLAB_DATA_DIR") or Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local/share")) / "ChessLab")
DB_PATH = USER_ROOT / "data" / "games.db"
CONFIG_PATH = USER_ROOT / "config.json"
LOG_DIR = USER_ROOT / "logs"


def migrate_legacy(legacy_root: Path, destination: Path = USER_ROOT):
    """Copy once without overwriting user files; SQLite backup includes committed WAL rows."""
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "data").mkdir(exist_ok=True)
    old_db, new_db = legacy_root / "data/games.db", destination / "data/games.db"
    if old_db.is_file() and not new_db.exists() and old_db.resolve() != new_db.resolve():
        temporary = new_db.with_suffix(".migrating")
        try:
            with closing(sqlite3.connect(f"{old_db.resolve().as_uri()}?mode=ro", uri=True, timeout=30)) as source:
                with closing(sqlite3.connect(temporary)) as target:
                    source.backup(target)
                    if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                        raise RuntimeError("Legacy database migration failed its integrity check")
            temporary.replace(new_db)
        finally:
            temporary.unlink(missing_ok=True)
    old_config, new_config = legacy_root / "config.json", destination / "config.json"
    if old_config.is_file() and not new_config.exists():
        shutil.copy2(old_config, new_config)
    old_exports = legacy_root / "data/exports"
    if old_exports.is_dir():
        for item in old_exports.rglob("*"):
            if item.is_file() and item.name != ".gitkeep":
                target = destination / "exports" / item.relative_to(old_exports)
                if not target.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(item, target)


def initialize():
    for folder in (USER_ROOT / "data", USER_ROOT / "exports", LOG_DIR):
        folder.mkdir(parents=True, exist_ok=True)
    if not os.environ.get("CHESSLAB_DATA_DIR") and not getattr(sys, "frozen", False):
        migrate_legacy(SOURCE_ROOT)


initialize()
