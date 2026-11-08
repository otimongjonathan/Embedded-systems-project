@echo off
rem One-time setup on Windows: creates .venv and installs the packages.
rem Double-click it, or run "setup.bat" in Command Prompt or PowerShell from this folder.
setlocal
cd /d "%~dp0"

echo.
echo === CoCIS API setup ===

rem 1. Find Python 3.10 or newer: the "py" launcher first, then "python".
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if defined PY goto :have_python
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if not errorlevel 1 set "PY=python"
if not defined PY goto :no_python
:have_python
echo Using:
%PY% --version

rem 2. A .venv copied from a Mac or from another computer does not work here: rebuild it.
if exist ".venv" (
    .venv\Scripts\python.exe -c "import sys" >nul 2>nul
    if errorlevel 1 (
        echo The existing .venv folder was made on another computer. Rebuilding it...
        rmdir /s /q ".venv"
    )
)

rem 3. Create the virtual environment and install the packages.
if not exist ".venv\Scripts\python.exe" (
    echo Creating the virtual environment in .venv ...
    %PY% -m venv .venv
    if errorlevel 1 goto :failed
)
echo Installing packages, this takes a minute the first time...
.venv\Scripts\python.exe -m pip install --upgrade pip --disable-pip-version-check -q
.venv\Scripts\python.exe -m pip install -r requirements.txt --disable-pip-version-check
if errorlevel 1 goto :failed
.venv\Scripts\python.exe -c "import fastapi, uvicorn, multipart, pytest" || goto :failed

echo.
echo Setup finished. Now run start.bat to start the API.
if not defined NOPAUSE pause
exit /b 0

:no_python
echo.
echo Python 3.10 or newer was not found.
echo  1. Download it from https://www.python.org/downloads/windows/
echo  2. In the installer, tick "Add python.exe to PATH", then click Install Now.
echo  3. Close this window, open a new one and run setup.bat again.
echo If "python" opens the Microsoft Store, turn off the python.exe and python3.exe
echo entries in Settings, Apps, Advanced app settings, App execution aliases.
if not defined NOPAUSE pause
exit /b 1

:failed
echo.
echo Setup failed. Read the messages above; README section 9 lists the usual fixes.
echo Check the internet connection: pip downloads the packages from pypi.org.
if not defined NOPAUSE pause
exit /b 1
