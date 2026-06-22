@echo off
REM ============================================================
REM  OMS - watch the dev server logs (servers run hidden).
REM  Close this window any time; it does NOT stop the servers.
REM ============================================================
cd /d "%~dp0"

if not exist "oms-dev.log" (
    echo No log file yet. Start the servers first with start.bat.
    echo.
    pause
    exit /b
)

echo ============================================================
echo   Live OMS dev server log  (close this window to stop watching)
echo ============================================================
echo.
powershell -NoProfile -Command "Get-Content -Path 'oms-dev.log' -Wait -Tail 200"
