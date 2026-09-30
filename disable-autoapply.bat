@echo off
REM OMS - Stop applying code changes by themselves (undo enable-autoapply.bat).
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Administrator rights are required to remove the task - asking for permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
schtasks /delete /tn "OMS Auto Apply" /f
echo.
echo   Code changes will again need restart.bat.   Turn back on: enable-autoapply.bat
echo.
pause
