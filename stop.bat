@echo off
REM ============================================================
REM  OMS - STOP servers
REM  Double-click this file to stop everything started by start.bat
REM  (or dev.bat, which manages its own console window).
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   Stopping OMS servers...
echo ============================================================
echo.

REM 1) Kill the "OMS Server" window and its whole child tree
REM    (npm, concurrently, NestJS, Vite and the tsc watchers).
taskkill /FI "WINDOWTITLE eq OMS Server*" /T /F >nul 2>&1
if "%errorlevel%"=="0" (
    echo - Closed the "OMS Server" window and its processes.
) else (
    echo - No "OMS Server" window was open.
)

REM 2) Fallback: free the ports in case anything is still bound
REM    (4173 = production web, 6173 = dev.bat's Vite dev server).
call :freeport 4000 API
call :freeport 4173 Web
call :freeport 6173 Web

REM 3) Final sweep: stop any leftover node/tsc processes that were
REM    started from THIS project folder (and nothing else).
powershell -NoProfile -Command "$root=(Get-Location).Path; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.Name -eq 'node.exe' -or $_.Name -eq 'tsc.exe') -and $_.CommandLine -like ('*'+$root+'*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo.
echo All OMS dev servers stopped.
echo.
REM Skip the prompt when called from restart.bat (passes "nopause").
if /i not "%~1"=="nopause" pause
exit /b

REM ----------------------------------------------------------------
:freeport
REM %1 = port number, %2 = friendly label
for /f "tokens=5" %%P in ('netstat -aon ^| findstr /C:":%~1 " ^| findstr "LISTENING"') do (
    echo - Stopping %~2 on port %~1 [PID %%P]
    taskkill /F /PID %%P >nul 2>&1
)
exit /b
