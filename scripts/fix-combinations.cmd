@echo off
setlocal
rem ---------------------------------------------------------------------------
rem  Convert composite designs ("DL+LOGO") into real Combinations, so a
rem  combination's cost and rate become the live sum of the designs it links
rem  and changing a base design moves every combination it belongs to.
rem
rem  Run this ONCE per database, after the code has been pulled and rebuilt.
rem  It backs up first, shows you the plan, and only converts if you say Y.
rem  Running it a second time does nothing - there is nothing left to convert.
rem
rem  Double-click to run.
rem ---------------------------------------------------------------------------
set "PATH=C:\Program Files\nodejs;%PATH%"
set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo.
echo ============================================================
echo   STEP 1 of 3   Backing up the database
echo ============================================================
call node "%~dp0backup-db.cjs"
if errorlevel 1 (
  echo.
  echo   BACKUP FAILED - stopping. Nothing has been changed.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   STEP 2 of 3   Working out the plan ^(nothing is changed yet^)
echo ============================================================
cd /d "%ROOT%\apps\api"
call npx ts-node --project tsconfig.json scripts\convert-composite-designs.ts --xlsx "%ROOT%\combination-plan.xlsx"
if errorlevel 1 (
  echo.
  echo   Could not read the catalogue - stopping. Nothing has been changed.
  echo   If it says "ts-node" is missing, run:  npm install
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   STEP 3 of 3   Your decision
echo ============================================================
echo.
echo   The full plan has been written to:
echo     %ROOT%\combination-plan.xlsx
echo.
echo   Open it and read the "Price Changes" sheet FIRST. Those are the
echo   items whose cost or rate will move to the sum of their parts.
echo.
choice /C YN /N /M "   Convert now? (Y = convert, N = quit and change nothing) "
if errorlevel 2 (
  echo.
  echo   Nothing was changed. Run this again when you are ready.
  pause
  exit /b 0
)

echo.
call npx ts-node --project tsconfig.json scripts\convert-composite-designs.ts --apply
if errorlevel 1 (
  echo.
  echo   CONVERSION FAILED. Your backup is in the backups\ folder.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   Done. Now restart the API so the order picker reloads:
echo       npm run start:api
echo ============================================================
pause
