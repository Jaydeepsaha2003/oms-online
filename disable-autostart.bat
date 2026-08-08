@echo off
REM ============================================================
REM  OMS - Disable auto-start at Windows power-on.
REM  Removes the Task Scheduler task created by enable-autostart.bat.
REM  Does NOT stop a server that's already running - use stop.bat for that.
REM  Requires administrator rights (one-time).
REM ============================================================

REM Self-elevate to Administrator if we are not already.
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Administrator rights are required - asking for permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0disable-autostart.ps1"

echo.
pause
