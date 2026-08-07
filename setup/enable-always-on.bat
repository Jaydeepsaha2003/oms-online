@echo off
REM ============================================================
REM  OMS - make the servers "on whenever the PC is on" (run ONCE).
REM
REM  Fixes the three machine-level reasons the app looked dead after a
REM  Wi-Fi drop or a reboot:
REM    1. No boot-time autostart was registered - the servers waited for
REM       somebody to log in before coming back after a restart.
REM    2. Windows was allowed to power down the USB Wi-Fi adapter, which
REM       is what made the Wi-Fi drop on its own several times an hour.
REM    3. Fast Startup + sleep made "power on" not mean "fully booted".
REM
REM  The servers themselves were never the problem - they stay up across
REM  Wi-Fi drops (verified in the logs and the Windows event log). What
REM  died was the 192.168.0.236 ADDRESS, not the server.
REM
REM  Requires administrator rights (one-time). To undo, see the notes
REM  printed at the end and disable-autostart.bat (same folder).
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
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-always-on.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Setup did not complete - see the message above.
    pause
    exit /b 1
)

pause
