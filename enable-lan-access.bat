@echo off
REM ============================================================
REM  OMS - Open Windows Firewall for LAN access (run ONCE)
REM  Lets phones/other devices on the same network reach the
REM  web (4173 production / 6173 dev) and API (4000) servers.
REM ============================================================

REM Self-elevate to Administrator if we are not already.
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Administrator rights are required - asking for permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo Opening firewall ports for OMS servers...
echo.

REM Replace any existing rules so re-running stays clean.
netsh advfirewall firewall delete rule name="OMS Web 6173" >nul 2>&1
netsh advfirewall firewall delete rule name="OMS Web 4173" >nul 2>&1
netsh advfirewall firewall delete rule name="OMS API 4000" >nul 2>&1

REM 4173 = start.bat / start-prod-secure.bat (production build, fast on mobile)
REM 6173 = dev.bat (raw Vite dev server, for active coding on this PC)
netsh advfirewall firewall add rule name="OMS Web 4173" dir=in action=allow protocol=TCP localport=4173
netsh advfirewall firewall add rule name="OMS Web 6173" dir=in action=allow protocol=TCP localport=6173
netsh advfirewall firewall add rule name="OMS API 4000" dir=in action=allow protocol=TCP localport=4000

echo.
echo Done. Other devices on the same Wi-Fi/network can now open the app.
echo Run start.bat, then browse to the "On your phone" URL it prints.
echo.
echo (Security note: these rules allow inbound on ports 4000/4173/6173. The app
echo  still requires login. To remove them later, run disable-lan-access.bat.)
echo.
pause
