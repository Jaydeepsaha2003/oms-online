@echo off
rem Launch the API dev server under the Claude Preview manager so it stays up
rem across turns (instead of dying like a one-off background task).
rem Ensures Node/npm are on PATH (the preview host process may predate the Node install).
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "C:\Users\saham\Documents\oms-online"
call npm run dev -w @oms/api
