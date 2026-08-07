@echo off
REM ============================================================
REM  OMS - Disable auto-start at Windows power-on.
REM  Removes the Task Scheduler task created by enable-autostart.bat AND the
REM  logon keep-alive shortcut that starts the watchdog.
REM  Does NOT stop a server that's already running - use stop.bat for that.
REM  (start.bat re-installs the keep-alive on every launch, so to keep OMS
REM  down on purpose use stop.bat, not this.)
REM  Requires administrator rights (one-time).
REM ============================================================

REM Self-elevate to Administrator if we are not already.
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Administrator rights are required - asking for permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

REM This script lives in setup\ - work from the project root above it.
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0disable-autostart.ps1"

echo.
pause
