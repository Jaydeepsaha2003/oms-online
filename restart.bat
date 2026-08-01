@echo off
REM ============================================================
REM  OMS - RESTART production servers, the fast way.
REM
REM  Instead of stop -> build -> start (app DOWN for the whole build), this
REM  builds the latest code FIRST while the current servers keep serving, and
REM  only stops + relaunches once the new build is ready. So:
REM    - the app stays up during the (incremental) build - downtime is just the
REM      few seconds it takes the fresh servers to boot, not build + boot;
REM    - a build error leaves the running servers completely untouched.
REM  The build itself is still incremental (start.bat skips everything that
REM  hasn't changed), so an unchanged relaunch is only a quick stop + start.
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   Restarting OMS - building first, servers stay up...
echo ============================================================
echo.

echo [1/3] Building the latest changes (current servers keep running)...
echo.
call "%~dp0start.bat" buildonly
if errorlevel 1 (
    echo.
    echo ============================================================
    echo   Build failed - the running servers were LEFT UNTOUCHED.
    echo   Fix the error above and run restart.bat again.
    echo ============================================================
    echo.
    pause
    exit /b 1
)

echo.
echo [2/3] Stopping the running servers...
call "%~dp0stop.bat" nopause

echo.
echo Waiting for ports 4000 / 6173 to be released...
powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(10); while((Get-Date) -lt $d){ if(-not (Get-NetTCPConnection -State Listen -LocalPort 4000,6173 -ErrorAction SilentlyContinue)){ break }; Start-Sleep -Milliseconds 200 }" >nul 2>&1

echo.
echo [3/3] Launching the freshly built servers...
echo.
REM OMS_PREBUILT tells start.bat the bundles are already current (built in step 1),
REM so it does the DB sync (safe now the DB is free) and launches - no second build
REM check. Scoped to this window + the start.bat it calls; a plain double-click of
REM start.bat never has it set.
set "OMS_PREBUILT=1"
call "%~dp0start.bat"
exit /b
