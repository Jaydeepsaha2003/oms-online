@echo off
REM ============================================================
REM  OMS - Open Windows Firewall for LAN access (run ONCE)
REM  Lets phones/other devices on the same network reach the
REM  web (6173 production / 5173 dev) and API (4000) servers.
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
netsh advfirewall firewall delete rule name="OMS Web 5173" >nul 2>&1
netsh advfirewall firewall delete rule name="OMS API 4000" >nul 2>&1

REM 6173 = start.bat (production build, fast on mobile)
REM 5173 = dev.bat (raw Vite dev server, for active coding on this PC)
netsh advfirewall firewall add rule name="OMS Web 6173" dir=in action=allow protocol=TCP localport=6173
netsh advfirewall firewall add rule name="OMS Web 5173" dir=in action=allow protocol=TCP localport=5173
netsh advfirewall firewall add rule name="OMS API 4000" dir=in action=allow protocol=TCP localport=4000

echo.
echo Done. Other devices on the same Wi-Fi/network can now open the app.
echo Run start.bat, then browse to the "On your phone" URL it prints.
echo.
echo (Security note: these rules allow inbound on ports 4000/6173/5173. The app
echo  still requires login. To remove them later, run disable-lan-access.bat.)
echo.
pause
