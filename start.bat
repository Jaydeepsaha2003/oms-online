@echo off
REM ============================================================
REM  OMS - START development servers (shared + API + web)
REM  Double-click to start everything.
REM
REM  On launch it auto-syncs so new code "just works":
REM    [1] npm install            (new / changed packages)
REM    [2] prisma migrate deploy  (apply new DB migrations)
REM    [3] prisma generate        (refresh the Prisma client)
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   Starting OMS development servers...
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

echo [1/3] Syncing dependencies (npm install)...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo npm install failed - fix the error above, then run start.bat again.
    echo.
    pause
    exit /b 1
)

echo.
echo [2/3] Applying database migrations (prisma migrate deploy)...
call npm run db:deploy
if errorlevel 1 echo    [warning] Migration step reported an error - check the output above.

echo.
echo [3/3] Refreshing the Prisma client (prisma generate)...
call npm run db:generate
if errorlevel 1 echo    [warning] Prisma generate reported an error - check the output above.

echo.
echo Sync complete - launching servers.
echo.

REM Detect this PC's LAN IPv4 (active adapter with a default gateway) via a temp file.
set "LANIP="
set "_ipf=%TEMP%\_oms_lanip.txt"
powershell -NoProfile -Command "$ip=(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress; if(-not $ip){ $ip=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress }; $ip" > "%_ipf%" 2>nul
if exist "%_ipf%" set /p LANIP=<"%_ipf%"
if exist "%_ipf%" del "%_ipf%" >nul 2>&1

REM Launch the dev servers HIDDEN (no console window). Output -> oms-dev.log.
echo Starting servers in the background...
wscript "%~dp0run-dev-hidden.vbs"

REM Wait until both ports are listening so we can confirm a real startup.
set "READY=1"
powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(45); while((Get-Date) -lt $d){ if((Get-NetTCPConnection -State Listen -LocalPort 4000 -EA SilentlyContinue) -and (Get-NetTCPConnection -State Listen -LocalPort 6173 -EA SilentlyContinue)){ exit 0 }; Start-Sleep -Milliseconds 700 }; exit 1"
if errorlevel 1 set "READY="

echo.
if defined READY (
    echo ============================================================
    echo   OMS dev servers are RUNNING in the background.
    echo ============================================================
    echo.
    echo   On this PC     :  http://localhost:6173
    if defined LANIP echo   On your phone  :  http://%LANIP%:6173
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
echo   View logs: logs.bat      Stop servers: stop.bat
echo.
echo This window closes automatically - the servers keep running in the background.
timeout /t 8 /nobreak >nul 2>&1
