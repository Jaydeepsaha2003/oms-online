@echo off
REM ============================================================
REM  OMS - START development servers (shared + API + web)
REM  Double-click this file to start everything.
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   Starting OMS development servers...
echo ============================================================
echo.

REM First-run convenience: install dependencies if they are missing.
if not exist "node_modules\" (
    echo node_modules not found - installing dependencies.
    echo This can take a few minutes the first time...
    echo.
    call npm install
    echo.
)

REM Detect this PC's LAN IPv4 (the active adapter that has a default gateway).
set "LANIP="
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPConfiguration ^| Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } ^| Select-Object -First 1).IPv4Address.IPAddress" 2^>nul') do set "LANIP=%%i"

REM Launch the dev servers in their own window titled "OMS Dev Server".
REM stop.bat finds and stops the server by this exact window title.
start "OMS Dev Server" cmd /k npm run dev

echo Dev servers are launching in a new window titled "OMS Dev Server".
echo.
echo   On this PC     :  http://localhost:6173
if defined LANIP echo   On your phone  :  http://%LANIP%:6173
echo.
echo   API: http://localhost:4000/api     Docs: http://localhost:4000/api/docs
echo.
echo Phone and PC must be on the SAME Wi-Fi / network.
echo First time only: run enable-lan-access.bat as administrator to open the firewall.
echo.
echo To stop the servers later, run stop.bat (or close that window).
echo.
timeout /t 8 /nobreak >nul 2>&1
