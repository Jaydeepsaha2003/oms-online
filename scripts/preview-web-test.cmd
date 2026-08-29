@echo off
REM Temporary: the web app talking to the TEST api on 4055, which runs against a
REM COPY of the database. The live server on 4000 is never involved.
set "PATH=C:\Program Files\nodejs;%PATH%"
set VITE_API_TARGET=http://127.0.0.1:4055
call npm run dev -w @oms/web -- --port 5299 --strictPort
