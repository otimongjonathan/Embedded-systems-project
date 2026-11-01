@echo off
rem Deletes the database so the next start.bat creates a fresh one with the demo data.
setlocal
cd /d "%~dp0"
echo This deletes every recorded scan, visit and change in data\cocis.db.
echo Stop the API first (Ctrl+C in its window).
choice /m "Delete the database"
if errorlevel 2 exit /b 0
del /q "data\cocis.db" "data\cocis.db-wal" "data\cocis.db-shm" 2>nul
if exist "data\cocis.db" (
    echo Could not delete it: the API is probably still running. Stop it and try again.
) else (
    echo Done. Run start.bat to create a fresh database.
)
pause
