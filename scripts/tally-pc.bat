@echo off
rem Tally PC automation, hidden in the background (a tray icon + the desktop icon show its details).
rem   no argument : starts it - or, if it already runs, only shows its details window
rem   "auto"      : what the Startup shortcut runs at logon (starts quietly, no window)
rem   anything else (-EnableWake, -List, -Once): runs visibly and waits for a key
if "%~1"=="" (
  start "" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0tally-pc.ps1" -Show
) else if /i "%~1"=="auto" (
  start "" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0tally-pc.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tally-pc.ps1" %*
  pause
)
