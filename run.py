"""Source and frozen launcher: local service plus a Brave app window."""
import argparse
import ctypes
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from app.paths import LOG_DIR, RESOURCE_ROOT, migrate_legacy
from app.release import release_info

HOST, PORT = "127.0.0.1", 8765
URL = f"http://{HOST}:{PORT}/"


def server_info():
    try:
        with urllib.request.urlopen(URL + "api/version", timeout=1) as response:
            return json.load(response)
    except (OSError, ValueError):
        return None


def open_window():
    candidates = [Path(os.environ.get(base, "")) / relative for base, relative in (
        ("PROGRAMFILES", "BraveSoftware/Brave-Browser/Application/brave.exe"),
        ("LOCALAPPDATA", "BraveSoftware/Brave-Browser/Application/brave.exe"),
        ("PROGRAMFILES(X86)", "BraveSoftware/Brave-Browser/Application/brave.exe"),
        ("PROGRAMFILES(X86)", "Microsoft/Edge/Application/msedge.exe"),
        ("PROGRAMFILES", "Microsoft/Edge/Application/msedge.exe"))]
    for executable in candidates:
        if executable.is_file():
            subprocess.Popen([str(executable), f"--app={URL}", "--window-size=1000,1000"], creationflags=0x08000000)
            return
    import webbrowser
    webbrowser.open(URL)


def stop_server():
    info = server_info()
    if info is None:
        return
    if info.get("app") not in (None, "ChessLab"):
        raise RuntimeError("Port 8765 is being used by a different application")
    request = urllib.request.Request(URL + "api/shutdown", method="POST", data=b"")
    try:
        urllib.request.urlopen(request, timeout=3).close()
    except urllib.error.HTTPError as error:
        if error.code == 400:
            raise RuntimeError("Stop the running experiment before upgrading Chess Lab") from error
        raise
    for _ in range(100):
        if server_info() is None:
            return
        time.sleep(0.1)
    raise RuntimeError("Chess Lab did not shut down; close it and try again")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-window", action="store_true")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--stop", action="store_true")
    parser.add_argument("--migrate-from", type=Path)
    args = parser.parse_args()
    global PORT, URL
    PORT = args.port
    URL = f"http://{HOST}:{PORT}/"
    if args.migrate_from:
        migrate_legacy(args.migrate_from.resolve())
        return
    if args.stop:
        stop_server()
        return
    info = server_info()
    if info and info.get("version") != release_info()["version"]:
        stop_server()
        info = None
    if info:
        if not args.no_window:
            open_window()
        return
    os.chdir(RESOURCE_ROOT)
    import socket
    with socket.socket() as probe:
        probe.settimeout(0.3)
        if probe.connect_ex((HOST, PORT)) == 0:
            raise RuntimeError(f"Port {PORT} is already in use; close the other application and try again")
    if not args.no_window:
        def opener():
            for _ in range(150):
                if server_info():
                    open_window()
                    return
                time.sleep(0.1)
        threading.Thread(target=opener, daemon=True).start()
    import uvicorn
    from app.server import app
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    log = (LOG_DIR / "server.log").open("a", buffering=1, encoding="utf-8")
    if sys.stdout is None or sys.stderr is None:
        sys.stdout = sys.stderr = log
    try:
        main()
    except Exception as error:
        import traceback
        traceback.print_exc(file=log)
        if "--no-window" not in sys.argv and os.name == "nt":
            ctypes.windll.user32.MessageBoxW(0, f"{error}\n\nDetails: {LOG_DIR / 'server.log'}", "Chess Lab could not start", 0x10)
        sys.exit(1)
