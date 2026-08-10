@echo off
REM ============================================================
REM  OMS - watch the dev server logs (servers run hidden).
REM  Close this window any time; it does NOT stop the servers.
REM ============================================================
cd /d "%~dp0"

REM Each launch writes its own file under logs\ - tail the newest one
REM (falls back to the old single oms-dev.log from before this change).
echo ============================================================
echo   Live OMS server log  (close this window to stop watching)
echo ============================================================
echo.
powershell -NoProfile -Command "$f = Get-ChildItem 'logs\*.log' -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if(-not $f -and (Test-Path 'oms-dev.log')){ $f = Get-Item 'oms-dev.log' }; if(-not $f){ Write-Host 'No log file yet. Start the servers first with start.bat.'; exit 1 }; Write-Host ('Watching: ' + $f.Name); Get-Content -Path $f.FullName -Wait -Tail 200"
if errorlevel 1 pause
