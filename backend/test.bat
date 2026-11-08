@echo off
rem Runs the automated tests. They use a temporary database, never data\cocis.db.
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Run setup.bat first.
    pause
    exit /b 1
)
.venv\Scripts\python.exe -m pytest -q tests
pause
