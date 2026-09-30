@echo off
rem Tally PC: leave this window open. Every bill posted to Tally (from any phone or PC) gets its e-invoice, e-way bill and print by itself.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tally-einvoice-watch.ps1"
pause
