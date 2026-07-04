@echo off
rem ── Start OMS (API + web) and KEEP IT RUNNING until you close this window ──────
rem Double-click this file. A window opens and stays open serving the app.
rem To stop the server: close this window, or press Ctrl+C inside it.
rem
rem Web (open this on your phone/PC):  https://localhost:6173
rem The API runs on port 4000 and is reached through the web server automatically.

title OMS server - close this window to stop
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"

echo ============================================================
echo   Starting OMS ... leave this window OPEN while you use it.
echo   Web:  https://localhost:6173
echo   Stop: close this window (or press Ctrl+C).
echo ============================================================
echo.

npm run dev

echo.
echo OMS server stopped. Press any key to close.
pause >nul
