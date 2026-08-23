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
REM  half-merged repo. Everything it does is written to logs\auto-pull.log.
REM
REM  No administrator rights needed - and deliberately so: it runs as YOU,
REM  because your GitHub sign-in lives in your own Windows credential store.
REM
REM  Change the interval:  set OMS_AUTOPULL_MINUTES=2  before running this.
REM  To undo, run disable-autopull.bat.
REM ============================================================
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-autopull.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Could not register the scheduled task - see the message above.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Done. Pushes from your other machine now arrive here on
echo   their own, usually within 5 minutes.
echo.
echo   Watch it work:   type logs\auto-pull.log
echo   Run it right now: powershell -ExecutionPolicy Bypass -File scripts\auto-pull.ps1
echo   Turn it off:     disable-autopull.bat
echo ============================================================
echo.
pause
