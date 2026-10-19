#!/bin/bash
# macOS source launcher (the Mac counterpart of ChessLab.bat). Double-click in Finder.
cd "$(dirname "$0")" || exit 1
if [ ! -x ".venv/bin/python" ]; then
  echo "First run: setting up Python environment..."
  PYTHON=""
  for candidate in python3.12 python3.11 python3.10; do
    if command -v "$candidate" >/dev/null 2>&1; then PYTHON="$candidate"; break; fi
  done
  if [ -z "$PYTHON" ]; then
    echo "Python 3.10-3.12 is required (PyTorch has no newer Intel-Mac builds)."
    read -r -p "Press Return to close." _; exit 1
  fi
  "$PYTHON" -m venv .venv || { echo "Setup failed"; read -r -p "Press Return to close." _; exit 1; }
fi
.venv/bin/python -c "import maia3" >/dev/null 2>&1 || {
  echo "Installing Maia-3 CPU runtime..."
  .venv/bin/python -m pip install -q -r requirements-mac-intel.txt || { echo "Setup failed"; read -r -p "Press Return to close." _; exit 1; }
}
if [ ! -x "engine/stockfish" ]; then
  echo "Note: Stockfish is not installed. Maia-3 will work, but Stockfish mode and experiments will not."
  echo "      Run scripts/build-stockfish-mac.sh to build it (needs Xcode command line tools)."
fi
nohup .venv/bin/python run.py >/dev/null 2>&1 &
# Close this Terminal window; the server keeps running in the background.
osascript -e 'tell application "Terminal" to close (every window whose name contains "ChessLab.command")' >/dev/null 2>&1 &
exit 0
