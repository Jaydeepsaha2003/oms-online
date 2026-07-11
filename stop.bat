@echo off
REM ============================================================
REM  OMS - STOP servers
REM  Double-click this file to stop everything started by start.bat
REM  (or dev.bat, which manages its own console window).
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   Stopping OMS servers...
echo ============================================================
echo.

REM Tell the auto-start watchdog this stop is intentional - the servers stay
REM stopped (even across reboots) until start.bat / restart.bat runs again.
echo stopped>".oms-stopped"

REM ---------- PRIMARY METHOD: kill every node/npm/cmd in THIS project ----------
REM This works regardless of window titles, hidden windows, or how the server
REM was launched (start.bat, autostart task, manual npm run start, etc.).
powershell -NoProfile -Command ^
  "$root = (Get-Location).Path;"^
  "Get-CimInstance Win32_Process | Where-Object {"^
  "  $_.CommandLine -and"^
  "  ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and"^
  "  $_.CommandLine -like ('*' + $root + '*')"^
  "} | ForEach-Object {"^
  "  Write-Host ('  - Stopping ' + $_.Name + ' [PID ' + $_.ProcessId + ']');"^
  "  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue"^
  "}"
echo.

REM ---------- FALLBACK: free the ports in case anything is still bound ----------
REM  (6173 = production web, 5173 = dev.bat's Vite dev server).
call :freeport 4000 API
call :freeport 6173 Web
call :freeport 5173 Web

REM ---------- ELEVATION: handle SYSTEM-owned processes from autostart task ----------
REM If a port is STILL held, the server was likely started by the boot-time
REM autostart task, which runs as SYSTEM - a normal window can't kill those
REM (every attempt above fails silently with "access denied"). Re-run this
REM script once as administrator so the kills actually succeed.
netstat -aon | findstr /C:":4000 " /C:":6173 " /C:":5173 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    net session >nul 2>&1
    if errorlevel 1 (
        echo.
        echo A server started at Windows boot ^(autostart task, runs as SYSTEM^)
        echo is still holding a port - administrator rights are needed to stop
        echo it. Asking for permission...
        powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList 'nopause' -Verb RunAs -Wait" >nul 2>&1
    )
)

echo.
echo All OMS dev servers stopped.
echo.
REM Skip the prompt when called from restart.bat (passes "nopause").
if /i not "%~1"=="nopause" pause
exit /b

REM ----------------------------------------------------------------
:freeport
REM %1 = port number, %2 = friendly label
for /f "tokens=5" %%P in ('netstat -aon ^| findstr /C:":%~1 " ^| findstr "LISTENING"') do (
    echo - Stopping %~2 on port %~1 [PID %%P]
    taskkill /F /PID %%P >nul 2>&1
)
exit /b
