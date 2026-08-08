@echo off
REM ============================================================
REM  OMS - keep the servers running (run ONCE, no admin needed).
REM  Installs a Startup-folder shortcut so the self-healing watchdog starts at
REM  every logon, then starts it right now. From then on the production servers
REM  come back on their own after a reboot, a logoff, or a crash - and stay up
REM  until you run stop.bat.
REM
REM  start.bat now does this automatically too; this script is here for when you
REM  want to set it up without a full start, or to confirm it's in place.
REM
REM  Want the servers up even BEFORE anyone logs in? Run enable-autostart.bat
REM  once as administrator as well (that one registers a SYSTEM task at boot).
REM  To undo this one, run disable-keepalive.bat.
REM ============================================================
cd /d "%~dp0"

echo Installing the OMS keep-alive...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-keepalive.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Could not install the keep-alive shortcut - see above.
    pause
    exit /b 1
)

REM Start the watchdog now as well, so you don't have to log out first. It exits
REM quietly if a copy is already running.
wscript.exe "%~dp0oms-watchdog.vbs"

REM An earlier stop.bat leaves this marker, which tells the watchdog to stay
REM hands-off. Clear it, since the point of running this is to keep OMS alive.
if exist ".oms-stopped" del ".oms-stopped" >nul 2>&1

echo.
echo ============================================================
echo   Keep-alive is active.
echo.
echo   The watchdog checks every minute and relaunches the servers
echo   if they ever stop. It restarts itself at every logon, so a
echo   reboot no longer leaves OMS down.
echo.
echo   Stop everything on purpose : stop.bat
echo   Turn this off             : disable-keepalive.bat
echo ============================================================
echo.
pause
