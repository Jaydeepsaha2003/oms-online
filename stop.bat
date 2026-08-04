@echo off
REM ============================================================
REM  OMS - STOP servers
REM  Double-click this file to stop everything started by start.bat
REM  (or dev.bat, which manages its own console window).
REM ============================================================
cd /d "%~dp0"

REM ---------- SCOPED STOP: bounce ONE server, leave the other serving --------
REM restart.bat uses this so a backend-only change never takes the web server
REM (or the page the user is looking at) down with it. Deliberately does NOT
REM write .oms-stopped: that marker tells the watchdog the shutdown was
REM intentional, and here we relaunch a second later - the watchdog healing us
REM in the meantime is fine. Only the port is freed; the broad project-wide
REM kill below would take out the OTHER server too.
REM Returns 0 only when the port is genuinely free. Callers MUST check: a
REM server left holding the port means the replacement dies on EADDRINUSE and
REM the OLD build keeps serving, which looks like a successful restart.
if /i "%~1"=="api" (
    echo Stopping the API only - the web server keeps serving...
    call :freeport 4000 API
    call :ensurefree 4000 api
    exit /b %ERRORLEVEL%
)
if /i "%~1"=="web" (
    echo Stopping the web server only - the API keeps serving...
    call :freeport 6173 Web
    call :ensurefree 6173 web
    exit /b %ERRORLEVEL%
)

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
REM CRITICAL: the cmd.exe hosting THIS script also has the project path in its
REM command line (double-click = cmd /c "...\stop.bat"), so the filter used to
REM kill the script's own console mid-run - the port fallback below then never
REM ran, leaving orphaned npm chains holding port 4000. Excluding this
REM process's own ancestor chain ($keep) keeps the script alive to the end.
powershell -NoProfile -Command ^
  "$root = (Get-Location).Path;"^
  "$keep = @(); $p = $PID;"^
  "for($i = 0; $i -lt 10 -and $p; $i++) {"^
  "  $keep += $p;"^
  "  $p = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p) -ErrorAction SilentlyContinue).ParentProcessId"^
  "};"^
  "Get-CimInstance Win32_Process | Where-Object {"^
  "  $_.CommandLine -and"^
  "  ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and"^
  "  $_.CommandLine -like ('*' + $root + '*') -and"^
  "  ($keep -notcontains $_.ProcessId)"^
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
:ensurefree
REM %1 = port, %2 = the scope argument to re-invoke this script with.
REM Confirms the port actually released, and escalates if it did not.
REM
REM taskkill silently fails on a server started by the boot-time autostart task
REM (it runs as SYSTEM, and a normal window has no rights over it) - the port
REM simply stays bound. The full-stop path below already re-runs itself as
REM administrator for this; the scoped path needs the same, or the caller
REM launches a replacement straight into EADDRINUSE.
powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(5); while((Get-Date) -lt $d){ if(-not (Get-NetTCPConnection -State Listen -LocalPort %~1 -EA SilentlyContinue)){ exit 0 }; Start-Sleep -Milliseconds 200 }; exit 1" >nul 2>&1
if not errorlevel 1 exit /b 0

net session >nul 2>&1
if not errorlevel 1 (
    echo   Port %~1 is still held even with administrator rights.
    exit /b 1
)
echo   Port %~1 is held by a SYSTEM-owned server ^(boot autostart^) - asking
echo   for administrator rights to stop it...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%~2' -Verb RunAs -Wait" >nul 2>&1
powershell -NoProfile -Command "if(Get-NetTCPConnection -State Listen -LocalPort %~1 -EA SilentlyContinue){ exit 1 }; exit 0" >nul 2>&1
if errorlevel 1 (
    echo   Could not free port %~1.
    exit /b 1
)
exit /b 0

REM ----------------------------------------------------------------
:freeport
REM %1 = port number, %2 = friendly label
for /f "tokens=5" %%P in ('netstat -aon ^| findstr /C:":%~1 " ^| findstr "LISTENING"') do (
    echo - Stopping %~2 on port %~1 [PID %%P]
    taskkill /F /PID %%P >nul 2>&1
)
exit /b
