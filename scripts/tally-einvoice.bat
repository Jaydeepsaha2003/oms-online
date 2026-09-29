@echo off
rem Double-click: e-invoice + e-way + print for the next pending SSS bill. Hands-off: do not touch the keyboard while it runs.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tally-einvoice-helper.ps1"
pause
