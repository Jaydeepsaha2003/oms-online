@echo off
REM ============================================================
REM  OMS - turn OFF the logon keep-alive (no admin needed).
REM  Removes the Startup-folder shortcut so the watchdog no longer starts at
REM  logon. Does NOT stop the servers and does NOT kill a watchdog that is
REM  already running - use stop.bat for that.
REM
REM  Note: start.bat re-installs the shortcut every time it runs, so if you want
REM  OMS to stay hands-off, use stop.bat rather than this.
REM ============================================================
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Join-Path ([Environment]::GetFolderPath('Startup')) 'OMS Keep Alive.lnk'; if (Test-Path $p) { Remove-Item $p -Force; Write-Host 'Removed the logon keep-alive shortcut.' } else { Write-Host 'The logon keep-alive was not installed - nothing to do.' }"

echo.
echo The watchdog will no longer start at logon.
echo To stop the running servers as well, run stop.bat.
echo.
pause
