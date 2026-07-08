@echo off
title OMS Dev Servers
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run - installing dependencies, please wait...
  call npm install
)

echo.
echo   OMS dev servers starting...
echo     API : http://localhost:4000/api
echo     Web : http://localhost:5173
echo.
echo   Keep this window open. Press Ctrl+C to stop.
echo.

rem Open the browser a few seconds after the web server boots
start "" cmd /c "timeout /t 8 >nul & start http://localhost:5173"

call npm run dev
pause
