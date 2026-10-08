"""Launcher: starts the server (if not already running) and opens the Chess Lab window."""
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST, PORT = "127.0.0.1", 8765
URL = f"http://{HOST}:{PORT}/"


def running() -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex((HOST, PORT)) == 0


def open_window():
    # Edge ships with Windows 11; --app gives a compact window with no browser chrome.
    subprocess.Popen(["cmd", "/c", "start", "", "msedge", f"--app={URL}", "--window-size=1000,1000"],
                     creationflags=0x08000000)


def local_version() -> str:
    import hashlib
    h = hashlib.md5()
    for f in sorted((ROOT / "app").glob("*.py")):
        h.update(f.read_bytes())
    return h.hexdigest()[:12]


def stale_server() -> bool:
    """True if the running server was started from older code than what's on disk."""
    import json
    import urllib.request
    try:
        with urllib.request.urlopen(URL + "api/version", timeout=2) as r:
            return json.load(r)["version"] != local_version()
    except Exception:
        return True  # no /api/version means it predates this check


def stop_server():
    import urllib.request
    try:
        urllib.request.urlopen(urllib.request.Request(URL + "api/shutdown", method="POST", data=b""), timeout=2)
    except Exception:
        out = subprocess.run(["netstat", "-ano", "-p", "tcp"], capture_output=True, text=True).stdout
        for line in out.splitlines():
            if f":{PORT} " in line and "LISTENING" in line:
                subprocess.run(["taskkill", "/F", "/PID", line.split()[-1]], capture_output=True)
    for _ in range(50):
        if not running():
            return
        time.sleep(0.1)


if __name__ == "__main__":
    if running() and stale_server():
        stop_server()
    if running():
        open_window()
        sys.exit(0)
    import os
    import threading

    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))
    (ROOT / "data").mkdir(exist_ok=True)
    log = open(ROOT / "data" / "server.log", "a", buffering=1)
    sys.stdout = sys.stderr = log  # pythonw has no console

    def opener():
        for _ in range(100):
            if running():
                return open_window()
            time.sleep(0.1)

    threading.Thread(target=opener, daemon=True).start()
    import uvicorn
    uvicorn.run("app.server:app", host=HOST, port=PORT, log_level="warning")
