@echo off
REM ============================================================
REM  OMS - Disable auto-start on Windows login.
REM  Removes the Startup-folder shortcut created by enable-autostart.bat.
REM  Does NOT stop a server that's already running - use stop.bat for that.
REM ============================================================
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0disable-autostart.ps1"

echo.
pause
