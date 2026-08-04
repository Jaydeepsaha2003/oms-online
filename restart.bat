@echo off
REM ============================================================
REM  OMS - RESTART production servers, the fast way.
REM
REM  Builds FIRST while the current servers keep serving, then relaunches only
REM  what actually changed:
REM
REM    frontend only  -> nothing is restarted at all. Both servers read
REM                      apps\web\dist from disk per request, so the new bundle
REM                      is live the moment the build finishes. ZERO downtime,
REM                      and the open page is untouched (it offers the update
REM                      as a pill and applies it when the user is idle).
REM    backend only   -> only the API is bounced (~3s). The web server, and
REM                      whatever page is on screen, carry on.
REM    shared package -> both, since API and web are both built from it.
REM
REM  A build error always leaves the running servers completely untouched.
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   Restarting OMS - building first, servers stay up...
echo ============================================================
echo.

REM ── What changed? MUST be decided BEFORE building ──────────────────────────
REM The check compares source timestamps against build outputs, and building is
REM exactly what makes those outputs newer - ask afterwards and everything looks
REM unchanged. Mirrors the per-package checks start.bat uses to decide what to
REM compile. Writes: full | api | web | none.
set "SCOPE=full"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restart-scope.ps1" > "%TEMP%\_oms_scope.txt" 2>nul
if exist "%TEMP%\_oms_scope.txt" set /p SCOPE=<"%TEMP%\_oms_scope.txt"
if exist "%TEMP%\_oms_scope.txt" del "%TEMP%\_oms_scope.txt" >nul 2>&1
if "%SCOPE%"=="" set "SCOPE=full"
echo Change scope: %SCOPE%
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

REM ── Relaunch only what the change actually touched ─────────────────────────
if /i "%SCOPE%"=="none" goto nothingtodo
if /i "%SCOPE%"=="web"  goto webonly
if /i "%SCOPE%"=="api"  goto apionly

echo [2/3] Stopping the running servers...
call "%~dp0stop.bat" nopause

echo.
echo Waiting for ports 4000 / 6173 to be released...
powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(10); while((Get-Date) -lt $d){ if(-not (Get-NetTCPConnection -State Listen -LocalPort 4000,6173 -ErrorAction SilentlyContinue)){ break }; Start-Sleep -Milliseconds 200 }" >nul 2>&1
goto launchstep

REM ---------------------------------------------------------------- web only
:webonly
echo ============================================================
echo   Frontend only - NOTHING was restarted.
echo ============================================================
echo.
echo   The new bundle is already live: both servers read apps\web\dist
echo   from disk on every request. Open pages keep running and will
echo   offer the update ^("Update ready"^), applying it once you are idle.
echo.
timeout /t 6 /nobreak >nul 2>&1
exit /b 0

REM ---------------------------------------------------------------- api only
:apionly
echo [2/3] Backend only - bouncing just the API ^(web server keeps serving^)...
call "%~dp0stop.bat" api
REM Never launch on a port the old server still holds: the new process would
REM die on EADDRINUSE and the OLD build would carry on serving, which looks
REM exactly like a successful restart while quietly running stale code.
if errorlevel 1 (
    echo.
    echo ============================================================
    echo   Could not stop the old API - port 4000 is still held.
    echo   NOTHING was restarted; the previous build is still serving.
    echo ============================================================
    echo.
    echo   Run stop.bat as administrator, then restart.bat again.
    echo.
    pause
    exit /b 1
)

echo.
echo [3/3] Starting the API...
if exist ".oms-stopped" del ".oms-stopped" >nul 2>&1
wscript.exe "%~dp0run-server-hidden.vbs" api
powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(45); while((Get-Date) -lt $d){ if(Get-NetTCPConnection -State Listen -LocalPort 4000 -EA SilentlyContinue){ exit 0 }; Start-Sleep -Milliseconds 400 }; exit 1"
if errorlevel 1 (
    echo.
    echo   The API did not come back within 45s - check logs.bat, or run
    echo   start.bat to bring everything up cleanly.
) else (
    echo.
    echo ============================================================
    echo   API updated. The web server never went down.
    echo ============================================================
    echo.
    echo   Open pages stayed put; anything that failed during the few
    echo   seconds it was restarting has already retried itself.
)
echo.
timeout /t 6 /nobreak >nul 2>&1
exit /b 0

REM ------------------------------------------------------------- nothing to do
:nothingtodo
echo ============================================================
echo   Nothing changed since the last build - servers left alone.
echo ============================================================
echo.
timeout /t 5 /nobreak >nul 2>&1
exit /b 0

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
