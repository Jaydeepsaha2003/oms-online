@echo off
rem ============================================================================
rem  OMS - Order Management System   ·   one-click offline launcher
rem  Double-click this file to start the app. It serves the whole system
rem  (web + API) from ONE local server, then opens it in your browser.
rem  Keep this window open while you use OMS; close it to stop the app.
rem ============================================================================
title OMS - Order Management System
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"

rem --- First run only: install + build the production bundles (needs internet ONCE) ---
if not exist "apps\api\dist\src\main.js" goto build
if not exist "apps\web\dist\index.html" goto build
goto run

:build
echo.
echo   First-time setup: building OMS (this happens only once, needs internet)...
echo.
call npm install || goto failed
call npm run build || goto failed

:run
echo.
echo   ============================================================
echo     OMS is starting...  your browser will open in a moment.
echo     On this PC:      http://localhost:4000/
echo     Other devices:   http://%COMPUTERNAME%:4000/  (same Wi-Fi)
echo.
echo     KEEP THIS WINDOW OPEN while using OMS. Close it to stop.
echo   ============================================================
echo.
rem open the browser a few seconds after the server starts listening
start "" cmd /c "timeout /t 5 >nul & start "" http://localhost:4000/"
cd apps\api
node dist\src\main.js
goto end

:failed
echo.
echo   *** Setup failed. Make sure you are online for the first build. ***
:end
echo.
pause
