@echo off
rem Stand-in for the entrance ESP32: publishes the same MQTT messages as its firmware.
setlocal
cd /d "%~dp0"
.venv\Scripts\python.exe -c "import paho.mqtt" >nul 2>nul
if errorlevel 1 (
    echo Installing the MQTT package, running setup.bat first...
    set "NOPAUSE=1"
    call setup.bat
)
.venv\Scripts\python.exe bridge\entrance_sim.py %*
pause
