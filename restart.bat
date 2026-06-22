@echo off
REM ============================================================
REM  OMS - RESTART development servers (stop, then start fresh)
REM  Double-click this to cleanly restart everything.
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   Restarting OMS development servers...
echo ============================================================
echo.

echo [1/2] Stopping any running servers...
call "%~dp0stop.bat" nopause

echo.
echo Waiting for ports 4000 / 6173 to be released...
powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(15); while((Get-Date) -lt $d){ if(-not (Get-NetTCPConnection -State Listen -LocalPort 4000,6173 -ErrorAction SilentlyContinue)){ break }; Start-Sleep -Milliseconds 400 }" >nul 2>&1

echo.
echo [2/2] Starting servers again...
echo.
call "%~dp0start.bat"
exit /b
