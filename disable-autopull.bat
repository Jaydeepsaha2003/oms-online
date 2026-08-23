@echo off
REM ============================================================
REM  OMS - Stop auto-pulling from GitHub.
REM  Removes the scheduled task. Your code and the running servers are
REM  left exactly as they are; only the automatic checking stops.
REM  Re-enable any time with enable-autopull.bat.
REM ============================================================
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$t='OMS Auto Pull'; if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $t -Confirm:$false; Write-Host \"Scheduled task '$t' removed - no more automatic pulls.\" } else { Write-Host \"Task '$t' was not registered - nothing to remove.\" }"

echo.
pause
