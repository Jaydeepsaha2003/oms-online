@echo off
rem Copy the OMS database to the backups\ folder (keeps the newest 30).
rem Double-click to back up now, or let the daily scheduled task run it.
set "PATH=C:\Program Files\nodejs;%PATH%"
node "%~dp0backup-db.cjs"
