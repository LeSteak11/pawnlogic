"""Shared release identity; frozen builds include a complete resource fingerprint."""
import hashlib
import json
from functools import lru_cache
from .paths import RESOURCE_ROOT


@lru_cache(maxsize=1)
def release_info():
    metadata = RESOURCE_ROOT / "release.json"
    if metadata.exists():
        return json.loads(metadata.read_text(encoding="utf-8"))
    h = hashlib.sha256()
    for f in sorted((RESOURCE_ROOT / "app").rglob("*")):
        if f.is_file() and f.suffix in (".py", ".js", ".css", ".html", ".svg", ".png", ".ico"):
            h.update(str(f.relative_to(RESOURCE_ROOT)).encode())
            h.update(f.read_bytes())
    return {"version": h.hexdigest()[:16], "release": (RESOURCE_ROOT / "VERSION").read_text().strip(), "app": "ChessLab"}
