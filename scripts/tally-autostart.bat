@echo off
rem Starts at Windows logon: tells OMS this PC address, opens Tally + logs in if it is not running. "tally-autostart.bat install" sets that up once.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tally-autostart.ps1" %*
