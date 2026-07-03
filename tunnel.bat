@echo off
REM ============================================================
REM  OMS - Start LocalTunnel for secure mobile testing (HTTPS)
REM  Exposes the local Vite dev server (6173) to a secure public
REM  HTTPS URL so that iOS Safari can prompt for mic permission.
REM ============================================================

echo Exposing port 6173 via secure HTTPS tunnel...
echo.
echo (Tip: If prompted, accept the tunnel, copy the URL, and open it on your phone.)
echo.
npx localtunnel --port 6173
pause
