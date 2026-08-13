@echo off
REM ============================================================
REM  OMS - RESET the admin password back to the .env default.
REM
REM  Normal restarts NEVER touch the admin password any more: start.bat's
REM  seed step only creates the admin the very first time, and after that
REM  leaves whatever password is set from the app alone. (It used to
REM  overwrite it on every re-seed, which is why a password changed one day
REM  was back to the old one the next morning.)
REM
REM  This script is the deliberate way back in if that password is ever
REM  forgotten. It re-hashes SEED_ADMIN_PASSWORD / SEED_ADMIN_PIN from
REM  apps\api\.env for SEED_ADMIN_EMAIL - nothing else in the database is
REM  changed, and no other user is affected.
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   Reset the OMS admin password
echo ============================================================
echo.

REM Show exactly which account and which password are about to be applied,
REM so nobody runs this expecting a different admin or a different value.
powershell -NoProfile -Command "$f='apps\api\.env'; if(-not (Test-Path $f)){ Write-Host '  [!] apps\api\.env not found.'; exit }; foreach($k in 'SEED_ADMIN_EMAIL','SEED_ADMIN_PASSWORD','SEED_ADMIN_PIN'){ $l=(Select-String -Path $f -Pattern ('^\s*'+$k+'\s*=') | Select-Object -First 1); if($l){ Write-Host ('  ' + $l.Line.Trim()) } else { Write-Host ('  ' + $k + ' = (not set - default will be used)') } }"

echo.
echo   The account above will be able to log in with that password again.
echo   Anyone still using the CURRENT password will be locked out.
echo.
choice /c YN /n /m "Reset it now? [Y/N] "
if errorlevel 2 (
    echo.
    echo Cancelled - nothing was changed.
    echo.
    pause
    exit /b 0
)

echo.
echo Resetting...
echo.

REM SEED_ADMIN_FORCE_RESET=1 is the ONLY thing that makes prisma/seed.ts write
REM over an existing admin's credentials. Scoped to this window via setlocal,
REM so it can never leak into a later start.bat in the same session.
setlocal
set "SEED_ADMIN_FORCE_RESET=1"
set "CHECKPOINT_DISABLE=1"
set "npm_config_update_notifier=false"
call npm run db:seed -w @oms/api
set "SEEDERR=%ERRORLEVEL%"
endlocal & set "SEEDERR=%SEEDERR%"

echo.
if not "%SEEDERR%"=="0" (
    echo ============================================================
    echo   The reset FAILED - see the error above. The password is
    echo   unchanged. If the message mentions a locked database file,
    echo   run stop.bat first, then this script again.
    echo ============================================================
) else (
    echo ============================================================
    echo   Done - log in with the password shown above, then change
    echo   it from the app. It will STAY changed from now on.
    echo ============================================================
)
echo.
pause
