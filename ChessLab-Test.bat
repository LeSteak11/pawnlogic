@echo off
cd /d "%~dp0"
set "CHESSLAB_DATA_DIR=%~dp0.test-data"
if not exist ".venv\Scripts\pythonw.exe" (
  echo First test run: setting up an isolated Python environment...
  python -m venv .venv && .venv\Scripts\python -m pip install -q -r requirements.txt || (echo Setup failed & pause & exit /b 1)
)
if not exist "engine\stockfish.exe" (
  echo Stockfish is missing from this test copy. Maia will run without tactical verification.
)
start "ChessLab Test" ".venv\Scripts\pythonw.exe" run.py --port 8766
