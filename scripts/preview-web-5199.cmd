@echo off
rem Vite dev server pinned to port 5199 for the Claude preview pane.
rem Kept separate from preview-web.cmd (which autoPorts) because the preview
rem pane only trusts an origin it has already been granted.
set "PATH=C:\Program Files\nodejs;%PATH%"
call npm run dev -w @oms/web -- --port 5199 --strictPort
