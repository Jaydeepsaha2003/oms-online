@echo off
rem Tally PC, all in one: tells OMS this PC address, opens Tally + logs in if needed, then e-invoices every posted bill. Runs by itself at logon after the first double-click. Leave the window open.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tally-pc.ps1" %*
pause
