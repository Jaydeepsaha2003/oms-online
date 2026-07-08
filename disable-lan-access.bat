@echo off
REM ============================================================
REM  OMS - Remove the LAN-access firewall rules added by
REM  enable-lan-access.bat.
REM ============================================================

REM Self-elevate to Administrator if we are not already.
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Administrator rights are required - asking for permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo Removing OMS firewall rules...
netsh advfirewall firewall delete rule name="OMS Web 6173" >nul 2>&1
netsh advfirewall firewall delete rule name="OMS Web 5173" >nul 2>&1
netsh advfirewall firewall delete rule name="OMS API 4000" >nul 2>&1

echo.
echo Done. Inbound access on ports 4000/6173/5173 is closed again.
echo.
pause
