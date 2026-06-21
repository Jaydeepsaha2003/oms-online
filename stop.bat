@echo off
REM ============================================================
REM  OMS - STOP development servers
REM  Double-click this file to stop everything started by start.bat.
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   Stopping OMS development servers...
echo ============================================================
echo.

REM 1) Kill the "OMS Dev Server" window and its whole child tree
REM    (npm, concurrently, NestJS, Vite and the tsc watchers).
taskkill /FI "WINDOWTITLE eq OMS Dev Server*" /T /F >nul 2>&1
if "%errorlevel%"=="0" (
    echo - Closed the "OMS Dev Server" window and its processes.
) else (
    echo - No "OMS Dev Server" window was open.
)

REM 2) Fallback: free the dev ports in case anything is still bound.
call :freeport 4000 API
call :freeport 6173 Web

REM 3) Final sweep: stop any leftover node/tsc processes that were
REM    started from THIS project folder (and nothing else).
powershell -NoProfile -Command "$root=(Get-Location).Path; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.Name -eq 'node.exe' -or $_.Name -eq 'tsc.exe') -and $_.CommandLine -like ('*'+$root+'*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo.
echo All OMS dev servers stopped.
echo.
pause
exit /b

REM ----------------------------------------------------------------
:freeport
REM %1 = port number, %2 = friendly label
for /f "tokens=5" %%P in ('netstat -aon ^| findstr /C:":%~1 " ^| findstr "LISTENING"') do (
    echo - Stopping %~2 on port %~1 [PID %%P]
    taskkill /F /PID %%P >nul 2>&1
)
exit /b
