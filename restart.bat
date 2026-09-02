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

REM -- Did the build we just ran leave the API behind? -----------------------
REM SCOPE was decided BEFORE building - it has to be, because building is what
REM moves the timestamps it compares. So a build that happened during this run
REM can leave the running API older than its own fresh dist while SCOPE still
REM says 'none', and the old process serves on with nothing to correct it. That
REM was the reported failure: "Change scope: none", then "API changed - building
REM API", then "running servers were left untouched".
REM
REM This check compares the PROCESS against dist and reads no source timestamps,
REM so it is valid after the build and decisive when it fires. It can only ever
REM escalate the work done, never skip any.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\api-stale.ps1"
if errorlevel 1 (
    if /i "%SCOPE%"=="none" set "SCOPE=api"
    if /i "%SCOPE%"=="web"  set "SCOPE=api"
    echo The running API predates the build just produced - bouncing it.
    echo.
)

REM ── Relaunch only what the change actually touched ─────────────────────────
if /i "%SCOPE%"=="none" goto nothingtodo
if /i "%SCOPE%"=="web"  goto webonly
if /i "%SCOPE%"=="api"  goto apionly

echo [2/3] Stopping the running servers...
REM Same marker the API-only bounce sets, and for the same reason - it was just
REM never set on THIS path. From the moment stop.bat runs until start.bat has
REM the ports listening, the machine looks dead to the watchdog: .oms-stopped is
REM cleared by start.bat ~30s BEFORE npm actually binds anything, so its 60s tick
REM would fire run-prod-hidden.vbs alongside ours and one of the two pairs would
REM die on EADDRINUSE. That is the "servers going ON/OFF" - see the 8s-apart pair
REM logs\oms-prod-20260831-181807.log (clean) and -181815.log (both ports taken).
echo restarting>".oms-restarting"
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
REM Tell the watchdog this half-dead moment is deliberate. Without it, its
REM 60s tick would start a second API alongside the one we are about to
REM launch and one of them would die on EADDRINUSE. Cleared in every exit
REM path below, and the watchdog ignores it after 3 minutes anyway.
echo restarting>".oms-restarting"
call "%~dp0stop.bat" api
REM Never launch on a port the old server still holds: the new process would
REM die on EADDRINUSE and the OLD build would carry on serving, which looks
REM exactly like a successful restart while quietly running stale code.
if errorlevel 1 (
    if exist ".oms-restarting" del ".oms-restarting" >nul 2>&1
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
REM Capture the result BEFORE anything else runs - `del` below would reset
REM errorlevel and the success check would then always read 0.
set "APIUP=1"
if errorlevel 1 set "APIUP="
REM Hand the watchdog back its job before reporting, either way: if the API
REM really did fail to come up, we WANT it healing that within the minute.
if exist ".oms-restarting" del ".oms-restarting" >nul 2>&1
if not defined APIUP (
    echo.
    echo   The API did not come back within 45s. The watchdog will try to
    echo   start it within a minute; check logs.bat if it stays down.
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
REM Re-stamp it here so the 180s staleness clock starts at the LAUNCH, not at a
REM stop that may have been followed by a long build. Reached by both routes in:
REM the ordinary stop-then-launch above, and the schema-changed one that stopped
REM early (that one is covered by .oms-stopped while it builds, but start.bat
REM deletes that marker the moment it is called).
echo restarting>".oms-restarting"
REM OMS_PREBUILT tells start.bat the bundles are already current (built in step 1),
REM so it does the DB sync (safe now the DB is free) and launches - no second build
REM check. Scoped to this window + the start.bat it calls; a plain double-click of
REM start.bat never has it set.
set "OMS_PREBUILT=1"
call "%~dp0start.bat"
REM Capture start.bat's result BEFORE the `del` below - deleting a file resets
REM errorlevel, so reading it afterwards always says 0.
set "RC=%ERRORLEVEL%"
REM Hand the watchdog its job back either way: if the servers really did fail to
REM come up, we WANT it healing them within the minute. By here start.bat has
REM already waited for both ports, so there is no window left to protect.
if exist ".oms-restarting" del ".oms-restarting" >nul 2>&1
exit /b %RC%

:buildfailed
REM Never leave the marker behind on a failure path: with the servers possibly
REM down (the schema-changed route stops them before building) the watchdog is
REM the only thing that will bring them back.
if exist ".oms-restarting" del ".oms-restarting" >nul 2>&1
REM ...and clear the STOP marker too, but only when THIS run is what stopped the
REM servers (the schema-changed route). That marker means "a human stopped this
REM on purpose, leave it down", so the watchdog obeys it forever - it is only
REM cleared automatically when it predates the last boot. A build that fails
REM after we stopped the servers therefore left the machine DOWN with healing
REM switched off, and it stayed that way until somebody noticed and ran
REM start.bat by hand; every open page just sat on "Updating the app...".
REM Clearing it hands the job back to the watchdog, which brings the PREVIOUS
REM (still perfectly good) build back within a minute. Left alone when we never
REM stopped anything, so a genuine stop.bat still stays stopped.
if defined STOPPEDFIRST if exist ".oms-stopped" del ".oms-stopped" >nul 2>&1
echo.
echo ============================================================
if defined STOPPEDFIRST (
    echo   Build failed - the servers were stopped for it, so the app is
    echo   DOWN. The watchdog will bring the PREVIOUS build back up within
    echo   a minute; fix the error above and run restart.bat again to
    echo   deploy the new one ^(or start.bat now to come back immediately^).
) else (
    echo   Build failed - the running servers were LEFT UNTOUCHED.
    echo   Fix the error above and run restart.bat again.
)
echo ============================================================
echo.
pause
exit /b 1
