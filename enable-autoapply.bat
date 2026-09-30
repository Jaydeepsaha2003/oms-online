@echo off
REM ============================================================
REM  OMS - Apply code changes by themselves (run ONCE).
REM
REM  After this, nobody has to run restart.bat after a code change.
REM  Every minute a task checks whether the code on this machine is newer
REM  than what is running. Once nobody has edited a file for 2 minutes, it
REM  runs restart.bat: build first, restart only what changed (a screen-only
REM  change restarts nothing), and keep the old version serving if the build
REM  fails.
REM
REM  Needs administrator rights ONCE, only to register the task.
REM  Log: logs\auto-apply.log      Turn off: disable-autoapply.bat
REM ============================================================
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Administrator rights are required to register the task - asking for permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
cd /d "%~dp0"

REM Run the task as the person signed in at the console (the elevated shell is "Administrator").
for /f "tokens=2 delims==" %%i in ('wmic computersystem get username /value 2^>nul ^| find "="') do set "OMS_TASK_USER=%%i"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-autoapply.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] The scheduled task was NOT created - see the message above.
    pause
    exit /b 1
)
echo.
echo   Done. Code changes now go live on their own, about 2-3 minutes after the last edit.
echo   Watch it work:  type logs\auto-apply.log
echo   Turn it off:    disable-autoapply.bat
echo.
pause
