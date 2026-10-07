@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo First run: setting up Python environment...
  python -m venv .venv && .venv\Scripts\python -m pip install -q -r requirements.txt || (echo Setup failed & pause & exit /b 1)
)
if not exist "engine\stockfish.exe" (
  echo Stockfish not found. Put stockfish.exe in the engine folder ^(see README^).
  pause & exit /b 1
)
start "" ".venv\Scripts\pythonw.exe" run.py
