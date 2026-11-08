@echo off
rem Scripted demonstration of every feature (start.bat must be running in another window).
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Run setup.bat first.
    pause
    exit /b 1
)
.venv\Scripts\python.exe simulator\virtual_esp32.py --demo %*
pause
