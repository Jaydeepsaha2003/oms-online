@echo off
REM ============================================================
REM  OMS - show the URL(s) to open on your phone RIGHT NOW.
REM  Works on the shop Wi-Fi AND on an iPhone hotspot: the HTTPS
REM  cert is pre-pinned for 192.168.0.236 and 172.20.10.2-14
REM  (see scripts\update-certs.ps1), so whichever network the PC
REM  is on, just open the printed https URL on the phone.
REM ============================================================
cd /d "%~dp0"
echo.
echo   Open ONE of these on your phone (same network as this PC):
echo.
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { '     https://' + $_.IPAddress + ':6173   (' + $_.InterfaceAlias + ')' }"
echo.
echo   Server status:
powershell -NoProfile -Command "if(Get-NetTCPConnection -State Listen -LocalPort 6173 -EA SilentlyContinue){ '     Web  6173: RUNNING' } else { '     Web  6173: NOT RUNNING - run start.bat' }; if(Get-NetTCPConnection -State Listen -LocalPort 4000 -EA SilentlyContinue){ '     API  4000: RUNNING' } else { '     API  4000: NOT RUNNING - run start.bat' }"
echo.
pause
