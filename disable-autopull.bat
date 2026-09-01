@echo off
REM ============================================================
REM  OMS - Stop auto-pulling from GitHub.
REM  Removes the scheduled task. Your code and the running servers are
REM  left exactly as they are; only the automatic checking stops.
REM  Re-enable any time with enable-autopull.bat.
REM
REM  Requires administrator rights, for the same reason enable-autopull.bat
REM  does: Windows will not let an unprivileged process touch a scheduled
REM  task. Without this the removal failed with "Access is denied" while the
REM  script still reported success, so the task kept pulling every 5 minutes.
REM ============================================================

REM Self-elevate to Administrator if we are not already.
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Administrator rights are required to remove the task - asking for permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0disable-autopull.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] The scheduled task was NOT removed - see the message above.
    echo         Auto-pull is still active.
    pause
    exit /b 1
)

echo.
echo   Check it is gone:  schtasks /query /tn "OMS Auto Pull"
echo   Turn it back on:   enable-autopull.bat
echo.
pause
