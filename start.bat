@echo off
REM ============================================================
REM  OMS - START production servers (shared + API + web)
REM  Double-click to build and start everything. Serves the
REM  bundled/minified build, not the raw dev server, so pages
REM  load fast on phones/other devices over the LAN, not just
REM  on this PC. For active coding with fast edit+refresh, use
REM  dev.bat instead.
REM
REM  Skips the sync/build below entirely if nothing under
REM  apps/*/src, packages/shared/src, prisma/schema.prisma, or any
REM  package.json has changed since the last build - most day-to-day
REM  starts finish in ~2 seconds instead of ~20-30. Any real change
REM  (or a fresh git pull) is detected automatically and triggers the
REM  full sync below, so you never run stale code.
REM
REM  On launch (when needed) it auto-syncs so new code "just works":
REM    [1] npm install            (new / changed packages)
REM    [2] prisma migrate deploy  (apply tracked DB migrations)
REM    [3] prisma db seed         (roles, permissions, admin user)
REM    [4] prisma db push         (sync schema - also refreshes the Prisma client)
REM    [5] npm run build          (build shared -> api -> web, bundled+minified)
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   Starting OMS production servers...
echo ============================================================
echo.

REM If a server is already running, skip the sync (its files are locked)
REM and point the user at restart.bat to pick up changes.
netstat -aon | findstr /C:":6173 " | findstr /C:"LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo Servers already appear to be running on http://localhost:6173.
    echo To apply code changes, run restart.bat instead.
    echo.
    pause
    exit /b
)

REM Fast path: skip the sync/build entirely if nothing has changed since the
REM last build (compares the newest source file's timestamp against the
REM existing build outputs' timestamps).
powershell -NoProfile -Command "$srcPaths=@('apps\api\src','apps\web\src','packages\shared\src','apps\api\prisma\schema.prisma','package.json','apps\api\package.json','apps\web\package.json','packages\shared\package.json'); $newestSrc=$null; foreach($p in $srcPaths){ if(Test-Path $p){ $items=Get-ChildItem -Path $p -Recurse -File -EA SilentlyContinue; if(-not $items){ $items=Get-Item $p -EA SilentlyContinue }; foreach($i in $items){ if(-not $newestSrc -or $i.LastWriteTime -gt $newestSrc){ $newestSrc=$i.LastWriteTime } } } }; $markers=@('packages\shared\dist\esm\index.js','apps\api\dist\src\main.js','apps\web\dist\index.html'); $allExist=$true; $oldestMarker=$null; foreach($m in $markers){ if(-not (Test-Path $m)){ $allExist=$false; break }; $mt=(Get-Item $m).LastWriteTime; if(-not $oldestMarker -or $mt -lt $oldestMarker){ $oldestMarker=$mt } }; if($allExist -and $newestSrc -and $oldestMarker -gt $newestSrc){ exit 0 } else { exit 1 }"
if not errorlevel 1 (
    echo Nothing has changed since the last build - skipping sync/build.
    echo ^(Want to force a full sync anyway? Use restart.bat, or delete the dist folders.^)
    echo.
    goto launch
)

echo [1/5] Syncing dependencies (npm install)...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo npm install failed - fix the error above, then run start.bat again.
    echo.
    pause
    exit /b 1
)

echo.
echo [2/5] Applying tracked migrations (prisma migrate deploy)...
call npm run db:deploy
if errorlevel 1 echo    [warning] Migration step reported an error - check the output above.

echo.
echo [3/5] Seeding database (roles, permissions, admin user)...
call npm run db:seed -w @oms/api
if errorlevel 1 echo    [warning] Seed step reported an error - check the output above.

echo.
echo [4/5] Syncing the schema / new tables (prisma db push)...
REM Pipe "n" so a (rare) data-loss prompt is auto-declined instead of hanging
REM the script; additive changes (new tables/columns) apply without any prompt.
REM db push also refreshes the Prisma client itself - no separate generate step needed.
echo n | call npm run db:push
if errorlevel 1 echo    [warning] Schema sync reported an error - check the output above.

echo.
echo [5/5] Building production bundles (npm run build)...
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
