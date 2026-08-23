@echo off
REM ============================================================
REM  OMS - Auto-pull from GitHub and restart (run ONCE).
REM
REM  Registers a Task Scheduler task that every 5 minutes:
REM    1. asks GitHub whether there are new commits (one `git fetch`);
REM    2. if there are, and this machine has NO uncommitted changes,
REM       fast-forwards to them;
REM    3. applies any new database migration;
REM    4. runs restart.bat - which builds first, restarts only what
REM       changed, and leaves the old build serving if the build fails.
REM
REM  Does nothing at all when the remote has nothing new, so the tick is
REM  effectively free. Refuses to pull over local edits rather than risk a
REM  half-merged repo. Everything it does goes to logs\auto-pull.log.
REM
REM  Needs administrator rights ONCE, only to register the task - Windows
REM  will not let anything create a scheduled task without them. The task
REM  itself then runs unprivileged, as YOU, because your GitHub sign-in
REM  lives in your own Windows credential store and SYSTEM cannot see it.
REM
REM  Change the interval:  set OMS_AUTOPULL_MINUTES=2  before running this.
REM  To undo, run disable-autopull.bat.
REM ============================================================

REM Self-elevate if we are not already administrator. The interval, if the user
REM set one, has to survive the elevation - a new process gets a clean
REM environment - so it is passed through as an argument.
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Administrator rights are required to register the task - asking for permission...
    if defined OMS_AUTOPULL_MINUTES (
        powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%OMS_AUTOPULL_MINUTES%' -Verb RunAs"
    ) else (
        powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    )
    exit /b
)

cd /d "%~dp0"
if not "%~1"=="" set "OMS_AUTOPULL_MINUTES=%~1"

REM The elevated shell runs as Administrator, but the task must run as the
REM person who is actually signed in - their credential store is the one with
REM the GitHub sign-in. Recover that name from the active console session
REM rather than %USERNAME%, which is now "Administrator".
for /f "tokens=2 delims==" %%i in ('wmic computersystem get username /value 2^>nul ^| find "="') do set "OMS_TASK_USER=%%i"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-autopull.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] The scheduled task was NOT created - see the message above.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Done. Pushes from your other machine now arrive here on
echo   their own, usually within 5 minutes.
echo.
echo   Watch it work:    type logs\auto-pull.log
echo   Run it right now: powershell -ExecutionPolicy Bypass -File scripts\auto-pull.ps1
echo   Check the task:   schtasks /query /tn "OMS Auto Pull"
echo   Turn it off:      disable-autopull.bat
echo ============================================================
echo.
pause
