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

REM ── Can this build actually happen while the servers are up? ───────────────
REM Only if the Prisma client is already current. When schema.prisma is newer,
REM the build needs `prisma generate`, which on Windows also replaces
REM node_modules\.prisma\client\query_engine-windows.dll.node - a file the
REM running API holds open, so the rename fails with EPERM. There is no way
REM around that lock other than not running: stop first and accept the downtime
REM for this one case. Every other restart keeps building while serving.
set "STOPPEDFIRST="
powershell -NoProfile -Command "$c='node_modules\.prisma\client\index.js'; $s='apps\api\prisma\schema.prisma'; if((Test-Path $c) -and (Test-Path $s) -and ((Get-Item $c).LastWriteTimeUtc -ge (Get-Item $s).LastWriteTimeUtc)){ exit 0 } else { exit 1 }"
if not errorlevel 1 goto buildstep

echo Schema changed, so the Prisma client has to be regenerated - and Windows
echo keeps its query engine locked while the API is running. Stopping the
echo servers first: the app is DOWN until the new build is up.
echo.
call "%~dp0stop.bat" nopause
echo.
echo Waiting for ports 4000 / 6173 to be released...
powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(10); while((Get-Date) -lt $d){ if(-not (Get-NetTCPConnection -State Listen -LocalPort 4000,6173 -ErrorAction SilentlyContinue)){ break }; Start-Sleep -Milliseconds 200 }" >nul 2>&1
set "STOPPEDFIRST=1"
echo.

:buildstep
echo [1/3] Building the latest changes...
echo.
call "%~dp0start.bat" buildonly
if errorlevel 1 goto buildfailed

echo.
if defined STOPPEDFIRST goto launchstep
echo [2/3] Stopping the running servers...
call "%~dp0stop.bat" nopause

echo.
echo Waiting for ports 4000 / 6173 to be released...
powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(10); while((Get-Date) -lt $d){ if(-not (Get-NetTCPConnection -State Listen -LocalPort 4000,6173 -ErrorAction SilentlyContinue)){ break }; Start-Sleep -Milliseconds 200 }" >nul 2>&1

:launchstep
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

:buildfailed
echo.
echo ============================================================
if defined STOPPEDFIRST (
    echo   Build failed - and the servers were already stopped for it,
    echo   so the app is DOWN. Fix the error above, then run
    echo   restart.bat again ^(or start.bat to come back up on the
    echo   previous build^).
) else (
    echo   Build failed - the running servers were LEFT UNTOUCHED.
    echo   Fix the error above and run restart.bat again.
)
echo ============================================================
echo.
pause
exit /b 1
