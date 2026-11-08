@echo off
rem Starts the API (the database is created on the first run) and opens the docs.
rem Options: start.bat --port 8001   start.bat --lan   start.bat --no-browser
setlocal
cd /d "%~dp0"

.venv\Scripts\python.exe -c "import uvicorn, multipart" >nul 2>nul
if errorlevel 1 (
    echo The packages are not installed yet, running setup.bat first...
    set "NOPAUSE=1"
    call setup.bat
    if errorlevel 1 (
        pause
        exit /b 1
    )
)

.venv\Scripts\python.exe run.py %*
echo.
echo The API has stopped.
pause
