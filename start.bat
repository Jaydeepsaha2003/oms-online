@echo off
REM ============================================================
REM  OMS - START production servers (shared + API + web)
REM  Double-click to build and start everything. Serves the
REM  bundled/minified build, not the raw dev server, so pages
REM  load fast on phones/other devices over the LAN, not just
REM  on this PC. For active coding with fast edit+refresh, use
REM  dev.bat instead.
REM
REM  DATABASE SYNC (migrate deploy -> db push -> seed) ALWAYS RUNS,
REM  every single launch, no matter what. This is what guarantees a
REM  client's database is fully up to date the moment you hand them
REM  a build - even if you shipped it with dist/ already built, which
REM  would otherwise make this look like a "nothing changed" restart.
REM  These three are near-instant no-ops when nothing is pending, so
REM  they don't meaningfully slow down day-to-day restarts.
REM
REM  Only the expensive part - npm install + npm run build - is ever
REM  skipped, and only when nothing under apps/*/src, packages/shared/src,
REM  prisma/schema.prisma, or any package.json has changed since the
REM  last build. Any real change (or a fresh git pull) is detected
REM  automatically and triggers a full rebuild, so you never run stale code.
REM
REM  On every launch:
REM    [1] npm install            (ONLY if node_modules is missing - first run)
REM    [2] prisma migrate deploy  (apply tracked DB migrations)
REM    [3] prisma db push         (sync schema - also refreshes the Prisma client;
REM                                 this project's migrations/ history is known to
REM                                 be incomplete, so this is the step that actually
REM                                 guarantees the schema is correct)
REM    [4] prisma db seed         (roles, permissions, admin user)
REM  Then, only if source changed since the last build:
REM    [5] npm install            (new / changed packages)
REM    [6] npm run build          (build shared -> api -> web, bundled+minified)
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   Starting OMS production servers...
echo ============================================================
echo.

REM If a server is already running, skip straight to a no-op notice - its
REM files are locked and a live server can't be re-synced out from under it.
netstat -aon | findstr /C:":6173 " | findstr /C:"LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo Servers already appear to be running on http://localhost:6173.
    echo To apply code changes or new migrations, run restart.bat instead.
    echo.
    pause
    exit /b
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

echo [1/3] Applying tracked migrations (prisma migrate deploy)...
call npm run db:deploy
if errorlevel 1 echo    [warning] Migration step reported an error - check the output above.

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
call npm run db:push
if errorlevel 1 echo    [warning] Schema sync reported an error - check the output above.

echo.
echo [3/3] Seeding database (roles, permissions, admin user)...
call npm run db:seed -w @oms/api
if errorlevel 1 echo    [warning] Seed step reported an error - check the output above.
echo.

REM Fast path: skip npm install + the build entirely if nothing has changed
REM since the last build (compares the newest source file's timestamp against
REM the existing build outputs' timestamps). The database sync above already
REM ran unconditionally, so this only ever skips the code-rebuild step.
powershell -NoProfile -Command "$srcPaths=@('apps\api\src','apps\web\src','packages\shared\src','apps\api\prisma\schema.prisma','package.json','apps\api\package.json','apps\web\package.json','packages\shared\package.json'); $newestSrc=$null; foreach($p in $srcPaths){ if(Test-Path $p){ $items=Get-ChildItem -Path $p -Recurse -File -EA SilentlyContinue; if(-not $items){ $items=Get-Item $p -EA SilentlyContinue }; foreach($i in $items){ if(-not $newestSrc -or $i.LastWriteTime -gt $newestSrc){ $newestSrc=$i.LastWriteTime } } } }; $markers=@('packages\shared\dist\esm\index.js','apps\api\dist\src\main.js','apps\web\dist\index.html'); $allExist=$true; $oldestMarker=$null; foreach($m in $markers){ if(-not (Test-Path $m)){ $allExist=$false; break }; $mt=(Get-Item $m).LastWriteTime; if(-not $oldestMarker -or $mt -lt $oldestMarker){ $oldestMarker=$mt } }; if($allExist -and $newestSrc -and $oldestMarker -gt $newestSrc){ exit 0 } else { exit 1 }"
if not errorlevel 1 (
    echo Nothing has changed since the last build - skipping the rebuild.
    echo ^(Database is already synced above, every launch, regardless.^)
    echo.
    goto launch
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
REM Detect this PC's LAN IPv4 (active adapter with a default gateway) via a temp file.
set "LANIP="
set "_ipf=%TEMP%\_oms_lanip.txt"
powershell -NoProfile -Command "$ip=(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress; if(-not $ip){ $ip=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress }; $ip" > "%_ipf%" 2>nul
if exist "%_ipf%" set /p LANIP=<"%_ipf%"
if exist "%_ipf%" del "%_ipf%" >nul 2>&1

REM Launch the production servers HIDDEN (no console window). Output -> oms-dev.log.
echo Starting servers in the background...
wscript "%~dp0run-prod-hidden.vbs"

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
    echo Open logs.bat to see what is happening (or check oms-dev.log).
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
