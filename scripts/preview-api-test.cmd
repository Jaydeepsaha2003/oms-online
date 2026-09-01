@echo off
REM TEST api on 4055, running against a COPY of the database (prisma\test.db).
REM The live server on 4000 and the live dev.db are never involved. Pairs with
REM scripts\preview-web-test.cmd, which points the web app here.
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0.."
set DATABASE_URL=file:./test.db
set API_PORT=4055
set CORS_ORIGINS=http://localhost:5299,http://127.0.0.1:5299
call npm run dev -w @oms/api
