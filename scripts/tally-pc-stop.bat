@echo off
rem Stops the Tally automation (it finishes the bill in hand first). Start it again with the desktop icon "Automation (Tally PC)".
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0tally-pc.ps1" -Stop
