@echo off
rem Double-click: e-invoice + e-way + print for the pending SSS bills (step by step for now; add -Auto -Max 20 once trusted).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tally-einvoice-helper.ps1"
pause
