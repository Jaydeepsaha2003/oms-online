@echo off
REM ============================================================
REM  OMS - Enable auto-start on Windows login (run ONCE).
REM  Creates a shortcut in your Startup folder that silently starts
REM  the OMS production server whenever you log into Windows, using
REM  whatever build is already on disk - no rebuild, so login stays
REM  fast. Does nothing if the server happens to already be running
REM  (e.g. the PC only slept). To pick up new code, still run
REM  restart.bat yourself afterwards.
REM  To undo this, run disable-autostart.bat.
REM ============================================================
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-autostart.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Could not create the Startup shortcut - see the message above.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Done. OMS will now start automatically next time you log
echo   into Windows (using whatever build is already on disk).
echo.
echo   To turn this off again, run disable-autostart.bat.
echo ============================================================
echo.
pause
