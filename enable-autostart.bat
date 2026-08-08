@echo off
REM ============================================================
REM  OMS - Enable auto-start at Windows power-on (run ONCE).
REM  Registers a Task Scheduler task (runs as SYSTEM) that silently starts
REM  the OMS production server as soon as Windows boots - before you even
REM  log in, no browser opened automatically, no rebuild (uses whatever
REM  build is already on disk; run restart.bat yourself after pulling new
REM  code). Skips launching if the server's already running.
REM  Requires administrator rights (one-time, to register the task).
REM  To undo, run disable-autostart.bat.
REM ============================================================

REM Self-elevate to Administrator if we are not already.
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Administrator rights are required - asking for permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-autostart.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Could not register the scheduled task - see the message above.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Done. OMS will now start automatically at Windows power-on,
echo   before you even log in - silently, with no browser opened.
echo.
echo   To turn this off again, run disable-autostart.bat.
echo ============================================================
echo.
pause
