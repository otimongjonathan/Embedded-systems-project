@echo off
rem MQTT bridge: stores the entrance ESP32's messages in the database (start.bat must be running).
setlocal
cd /d "%~dp0"
.venv\Scripts\python.exe -c "import paho.mqtt" >nul 2>nul
if errorlevel 1 (
    echo Installing the MQTT package, running setup.bat first...
    set "NOPAUSE=1"
    call setup.bat
)
.venv\Scripts\python.exe bridge\mqtt_bridge.py %*
pause
