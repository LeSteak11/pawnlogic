@echo off
rem One-time: makes the "Chess Lab" Desktop + Start menu shortcuts (no console window when you open the app).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make_shortcuts.ps1" > "%~dp0data\shortcuts.log" 2>&1
