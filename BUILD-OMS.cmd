@echo off
rem ============================================================================
rem  Rebuild OMS after any code change. Run this (needs internet), then use
rem  START-OMS to launch the freshly built app. Day-to-day you only need
rem  START-OMS; run this only when the app's code has changed.
rem ============================================================================
title OMS - Build
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"

echo Installing dependencies...
call npm install || goto failed
echo Building shared + API + web...
call npm run build || goto failed

echo.
echo   Build complete. You can now run START-OMS.
echo.
pause
goto :eof

:failed
echo.
echo   *** Build failed (see messages above). You must be online to build. ***
echo.
pause
