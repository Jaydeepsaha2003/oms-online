@echo off
REM ============================================================
REM  OMS - START Production Servers (Pre-compiled & HTTPS Secure)
REM  Loads instantly on mobile and enables microphone/chime alerts.
REM ============================================================
title OMS Production (Secure HTTPS)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   Building and launching OMS Production Servers...
echo ============================================================
echo.

REM Stop any running background instances first to free up ports
call stop.bat >nul 2>&1

echo [1/2] Rebuilding optimized production bundles...
call npm run build
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. Please fix the error above.
  pause
  exit /b 1
)

REM Detect this PC's LAN IPv4 (active adapter with a default gateway)
set "LANIP="
set "_ipf=%TEMP%\_oms_lanip.txt"
powershell -NoProfile -Command "$ip=(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress; if(-not $ip){ $ip=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress }; $ip" > "%_ipf%" 2>nul
if exist "%_ipf%" set /p LANIP=<"%_ipf%"
if exist "%_ipf%" del "%_ipf%" >nul 2>&1

echo.
echo [2/2] Launching production servers...
echo.
echo   ============================================================
echo     OMS Production (Secure HTTPS) is starting...
echo.
echo     On this PC     :  https://localhost:4173
if defined LANIP echo     On your phone  :  https://%LANIP%:4173
echo.
echo     Keep this window open. Press Ctrl+C to stop.
echo   ============================================================
echo.

rem Open the browser a few seconds after the server boots
if defined LANIP (
  start "" cmd /c "timeout /t 5 >nul & start https://localhost:4173"
)

call npm run start
pause
