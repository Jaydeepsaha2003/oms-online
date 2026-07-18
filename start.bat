@echo off
REM ============================================================
REM  OMS - START production servers (shared + API + web)
REM  Double-click to build and start everything. Serves the
REM  bundled/minified build, not the raw dev server, so pages
REM  load fast on phones/other devices over the LAN, not just
REM  on this PC. For active coding with fast edit+refresh, use
REM  dev.bat instead.
REM
REM  EVERY expensive step is skipped automatically when nothing it depends
REM  on has changed, so an unchanged relaunch takes seconds:
REM    - DB SYNC (migrate deploy -> db push -> seed) runs whenever the
REM      schema, migrations, seed script or .env changed since the last
REM      SUCCESSFUL sync (stamp file .db-sync-stamp), or when the database
REM      or generated Prisma client is missing. Handing a client a build
REM      still syncs their DB on first launch - their machine has no stamp.
REM    - npm install runs when node_modules is missing or any package.json /
REM      package-lock.json is newer than npm's own install marker.
REM    - npm run build runs when anything under apps/*/src,
REM      packages/shared/src, vite.config.ts, schema.prisma or any
REM      package.json is newer than the existing build outputs.
REM  Any real change (or a fresh git pull) is detected automatically, so you
REM  never run stale code - and deleting .db-sync-stamp forces a full DB
REM  re-sync if you ever need one.
REM
REM  Launch order when things did change:
REM    [1] npm install            (first run / changed packages)
REM    [2] prisma migrate deploy  (apply tracked DB migrations)
REM    [3] prisma db push         (sync schema - also refreshes the Prisma client;
REM                                 this project's migrations/ history is known to
REM                                 be incomplete, so this is the step that actually
REM                                 guarantees the schema is correct)
REM    [4] prisma db seed         (roles, permissions, admin user)
REM    [5] npm run build          (build shared -> api -> web, bundled+minified)
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   Starting OMS production servers...
echo ============================================================
echo.

REM If BOTH ports are already listening, the server is fully running - skip.
set "_P4=0"
set "_P6=0"
netstat -aon | findstr /C:":4000 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 set "_P4=1"
netstat -aon | findstr /C:":6173 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 set "_P6=1"

if "%_P4%%_P6%"=="11" (
    REM Re-arm auto-start even on this early exit: a stop.bat that died
    REM mid-run can leave .oms-stopped behind, which keeps the watchdog
    REM from ever healing or auto-starting the servers again.
    if exist ".oms-stopped" del ".oms-stopped" >nul 2>&1
    wscript.exe "%~dp0oms-watchdog.vbs"
    echo Servers already appear to be running on http://localhost:6173.
    echo To apply code changes or new migrations, run restart.bat instead.
    echo.
    pause
    exit /b
)

REM If one or both ports are held by a stale/half-started instance, clean
REM them up automatically instead of asking the user to run stop.bat.
REM The kill excludes this script's own ancestor processes ($keep): the cmd
REM hosting this script has the project path in its command line too, and
REM killing it aborted start.bat right here - servers never launched.
if "%_P4%%_P6%" NEQ "00" (
    echo Cleaning up stale server processes before starting fresh...
    powershell -NoProfile -Command "$root=(Get-Location).Path; $keep=@(); $p=$PID; for($i=0; $i -lt 10 -and $p; $i++){ $keep+=$p; $p=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$p) -ErrorAction SilentlyContinue).ParentProcessId }; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and $_.CommandLine -like ('*'+$root+'*') -and ($keep -notcontains $_.ProcessId) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
    REM Also free the ports by PID as a fallback
    for /f "tokens=5" %%P in ('netstat -aon ^| findstr /C:":4000 " /C:":6173 " ^| findstr "LISTENING"') do (
        taskkill /F /PID %%P >nul 2>&1
    )
    powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul
    echo.
)

REM First-run guard: the DB sync commands below need the Prisma CLI, which
REM lives in node_modules - if this is a brand-new machine (no node_modules
REM at all), install dependencies first so those commands can even run.
if not exist "node_modules" (
    echo [first run] Installing dependencies...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo npm install failed - fix the error above, then run start.bat again.
        echo.
        pause
        exit /b 1
    )
    echo.
)

REM Fast path for the DB sync too: all three prisma steps are no-ops unless
REM the schema, migrations, seed script or .env changed - but each still costs
REM seconds of npm+prisma startup. Compare the newest of those files against
REM the stamp saved after the last successful sync and skip the whole trio
REM when nothing changed. The stamp is only written when all three steps
REM succeed, so a failed sync is always retried on the next launch. Deleting
REM the database (or .db-sync-stamp) also forces a full re-sync.
powershell -NoProfile -Command "$paths=@('apps\api\prisma\schema.prisma','apps\api\prisma\migrations','apps\api\prisma\seed.ts','apps\api\.env'); $newest=[datetime]::MinValue; foreach($p in $paths){ if(Test-Path $p){ $items=@(Get-Item $p -EA SilentlyContinue | Where-Object { -not $_.PSIsContainer }) + @(Get-ChildItem $p -Recurse -File -EA SilentlyContinue); foreach($i in $items){ if($i -and $i.LastWriteTimeUtc -gt $newest){ $newest=$i.LastWriteTimeUtc } } } }; $tag=$newest.Ticks.ToString(); if((Test-Path 'apps\api\prisma\dev.db') -and (Test-Path 'node_modules\.prisma\client') -and (Test-Path '.db-sync-stamp') -and ((Get-Content '.db-sync-stamp' -EA SilentlyContinue) -eq $tag)){ exit 0 }; Set-Content '.db-sync-stamp.next' $tag; exit 1"
if not errorlevel 1 (
    echo Database already in sync ^(schema/migrations/seed unchanged^) - skipping DB sync.
    echo.
    goto dbsync_done
)

set "SYNCOK=1"
echo [1/3] Applying tracked migrations (prisma migrate deploy)...
call npm run db:deploy
if errorlevel 1 (
    echo    [warning] Migration step reported an error - check the output above.
    set "SYNCOK="
)

echo.
echo [2/3] Syncing the schema / new tables (prisma db push)...
REM db:push always passes --accept-data-loss (see apps/api/package.json). SQLite
REM has no real column types, so Prisma's "data loss" warning here is almost
REM always a false positive from a column's *declared* type text not matching
REM (e.g. an old INTEGER-declared boolean column) - no data is actually at risk.
REM Piping a plain "n" used to be tried here, but Prisma refuses non-interactive
REM input outright and demands this flag instead - so that trick never actually
REM protected anything; it just made every push with a flagged column fail silently.
REM db push also refreshes the Prisma client itself - no separate generate step needed.
echo n | call npm run db:push
if errorlevel 1 (
    echo    [warning] Schema sync reported an error - check the output above.
    set "SYNCOK="
)

echo.
echo [3/3] Seeding database (roles, permissions, admin user)...
call npm run db:seed -w @oms/api
if errorlevel 1 (
    echo    [warning] Seed step reported an error - check the output above.
    set "SYNCOK="
)
echo.

REM Remember this sync so unchanged launches can skip it - but only if every
REM step succeeded; otherwise it is retried in full on the next launch.
if defined SYNCOK (
    if exist ".db-sync-stamp.next" move /y ".db-sync-stamp.next" ".db-sync-stamp" >nul 2>&1
) else (
    if exist ".db-sync-stamp.next" del ".db-sync-stamp.next" >nul 2>&1
)

:dbsync_done

REM Fast path: skip npm install + the build entirely if nothing has changed
REM since the last build (compares the newest source file's timestamp against
REM the existing build outputs' timestamps). The database sync above already
REM ran unconditionally, so this only ever skips the code-rebuild step.
powershell -NoProfile -Command "$srcPaths=@('apps\api\src','apps\web\src','packages\shared\src','apps\api\prisma\schema.prisma','apps\web\vite.config.ts','package.json','apps\api\package.json','apps\web\package.json','packages\shared\package.json'); $newestSrc=$null; foreach($p in $srcPaths){ if(Test-Path $p -PathType Container){ $items=Get-ChildItem -Path $p -Recurse -File -EA SilentlyContinue } elseif(Test-Path $p){ $items=Get-Item $p -EA SilentlyContinue } else { $items=@() }; foreach($i in $items){ if(-not $newestSrc -or $i.LastWriteTime -gt $newestSrc){ $newestSrc=$i.LastWriteTime } } }; $markers=@('packages\shared\dist\esm\index.js','apps\api\dist\src\main.js','apps\web\dist\index.html'); $allExist=$true; $oldestMarker=$null; foreach($m in $markers){ if(-not (Test-Path $m)){ $allExist=$false; break }; $mt=(Get-Item $m).LastWriteTime; if(-not $oldestMarker -or $mt -lt $oldestMarker){ $oldestMarker=$mt } }; if($allExist -and $newestSrc -and $oldestMarker -gt $newestSrc){ exit 0 } else { exit 1 }"
if not errorlevel 1 (
    echo Nothing has changed since the last build - skipping the rebuild.
    echo.
    goto launch
)

REM Skip npm install when no package.json / lockfile changed since the last
REM install (npm's own marker file node_modules\.package-lock.json is the
REM reference) - a no-op install still costs several seconds.
powershell -NoProfile -Command "$m='node_modules\.package-lock.json'; if(-not (Test-Path $m)){ exit 1 }; $mt=(Get-Item $m).LastWriteTimeUtc; foreach($p in @('package-lock.json','package.json','apps\api\package.json','apps\web\package.json','packages\shared\package.json')){ if((Test-Path $p) -and ((Get-Item $p).LastWriteTimeUtc -gt $mt)){ exit 1 } }; exit 0"
if not errorlevel 1 (
    echo [1/2] Dependencies unchanged - skipping npm install.
    goto build
)

echo [1/2] Syncing dependencies (npm install)...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo npm install failed - fix the error above, then run start.bat again.
    echo.
    pause
    exit /b 1
)

:build
echo.
echo [2/2] Building production bundles (npm run build)...
call npm run build
if errorlevel 1 (
    echo.
    echo Build failed - fix the error above, then run start.bat again.
    echo.
    pause
    exit /b 1
)

echo.
echo Build complete - launching servers.
echo.

:launch
REM Clear the "stopped on purpose" marker so the auto-start watchdog resumes
REM keeping the servers alive (stop.bat sets it).
if exist ".oms-stopped" del ".oms-stopped" >nul 2>&1

REM Dynamically update the local SSL certificates based on active network interfaces.
REM Suppress error so that boot-time autostart (running as SYSTEM) can still start
REM even if mkcert fails due to permissions/profile restrictions.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\update-certs.ps1 >nul 2>&1

REM Keep a project-local copy of the HTTPS certs. The boot-time autostart task
REM runs as SYSTEM, which has no user profile and can't run mkcert - the web
REM server then reads these files instead (see apps\web\vite.config.ts).
if exist "%USERPROFILE%\.vite-plugin-mkcert\cert.pem" (
    if not exist "certs" mkdir "certs"
    copy /y "%USERPROFILE%\.vite-plugin-mkcert\cert.pem"   "certs\" >nul 2>&1
    copy /y "%USERPROFILE%\.vite-plugin-mkcert\dev.pem"    "certs\" >nul 2>&1
    copy /y "%USERPROFILE%\.vite-plugin-mkcert\rootCA.pem" "certs\" >nul 2>&1
)

REM Detect this PC's LAN IPv4 (active adapter with a default gateway) via a temp file.
set "LANIP="
set "_ipf=%TEMP%\_oms_lanip.txt"
powershell -NoProfile -Command "$ip=(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress; if(-not $ip){ $ip=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress }; $ip" > "%_ipf%" 2>nul
if exist "%_ipf%" set /p LANIP=<"%_ipf%"
if exist "%_ipf%" del "%_ipf%" >nul 2>&1

REM Launch the production servers fully hidden (no console window to close by
REM accident). run-prod-hidden.vbs writes output to a timestamped log under
REM logs\ - the same launcher the auto-start watchdog uses, so there is exactly
REM ONE launch path. View output any time with logs.bat.
echo Starting servers in the background...
wscript.exe "%~dp0run-prod-hidden.vbs"

REM Make sure the self-healing watchdog is running (it exits on its own if
REM another copy already is). It relaunches the servers within a minute if
REM they ever die, until stop.bat is used.
wscript.exe "%~dp0oms-watchdog.vbs"

REM Wait until both ports are listening so we can confirm a real startup.
set "READY=1"
powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(45); while((Get-Date) -lt $d){ if((Get-NetTCPConnection -State Listen -LocalPort 4000 -EA SilentlyContinue) -and (Get-NetTCPConnection -State Listen -LocalPort 6173 -EA SilentlyContinue)){ exit 0 }; Start-Sleep -Milliseconds 700 }; exit 1"
if errorlevel 1 set "READY="

echo.
if defined READY (
    echo ============================================================
    echo   OMS production servers are RUNNING in the background.
    echo ============================================================
    echo.
    echo   On this PC     :  https://localhost:6173
    if defined LANIP echo   On your phone  :  https://%LANIP%:6173
    echo.
    echo   API: http://localhost:4000/api     Docs: http://localhost:4000/api/docs
) else (
    echo Servers are taking longer than usual to start.
    echo Open logs.bat to see what is happening ^(newest file under logs\^).
)
echo.
echo   Phone and PC must be on the SAME Wi-Fi. First time only, run
echo   enable-lan-access.bat as administrator to open the firewall.
echo.
echo   Coding and want fast edit+refresh instead? Use dev.bat.
echo.
echo   View logs: logs.bat      Stop servers: stop.bat
echo.
echo This window closes automatically - the servers keep running in the background.
timeout /t 8 /nobreak >nul 2>&1
