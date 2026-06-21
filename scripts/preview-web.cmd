@echo off
rem Launch the web dev server for the Claude preview tool.
rem Ensures Node/npm are on PATH (the preview host process may predate the Node install).
set "PATH=C:\Program Files\nodejs;%PATH%"
call npm run dev -w @oms/web
