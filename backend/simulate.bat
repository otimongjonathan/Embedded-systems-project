@echo off
rem Virtual ESP32: the controller's serial menu, talking to the API (start.bat must be running).
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Run setup.bat first.
    pause
    exit /b 1
)
.venv\Scripts\python.exe simulator\virtual_esp32.py %*
pause
