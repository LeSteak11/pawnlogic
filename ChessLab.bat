@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo First run: setting up Python environment...
  python -m venv .venv && .venv\Scripts\python -m pip install -q -r requirements.txt || (echo Setup failed & pause & exit /b 1)
)
.venv\Scripts\python -c "import maia3" >nul 2>&1 || (
  echo Installing Maia-3 CPU runtime...
  .venv\Scripts\python -m pip install -q -r requirements.txt || (echo Setup failed & pause & exit /b 1)
)
if not exist "engine\stockfish.exe" (
  echo Note: Stockfish is not installed. Maia-3 will work, but Stockfish mode and experiments will not.
)
start "" ".venv\Scripts\pythonw.exe" run.py
