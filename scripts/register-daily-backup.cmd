@echo off
rem ============================================================================
rem  Register a Windows scheduled task that backs up the OMS database every day
rem  at 9:00 PM. Run this ONCE (double-click). To change the time or remove it,
rem  open "Task Scheduler" and find "OMS Daily DB Backup".
rem ============================================================================
schtasks /Create /SC DAILY /ST 21:00 /TN "OMS Daily DB Backup" /TR "\"%~dp0backup-db.cmd\"" /F
if errorlevel 1 (
  echo.
  echo   Could not register the task. Try running this file as Administrator
  echo   ^(right-click ^> Run as administrator^).
) else (
  echo.
  echo   Done. OMS will back up its database every day at 9:00 PM into the
  echo   "backups" folder. Run backup-db.cmd any time to back up on demand.
)
echo.
pause
