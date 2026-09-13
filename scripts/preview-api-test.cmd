@echo off
REM TEST api on 4055, running against a COPY of the database (prisma\test.db).
REM The live server on 4000 and the live dev.db are never involved. Pairs with
REM scripts\preview-web-test.cmd, which points the web app here.
set "PATH=C:\Program Files\nodejs;%PATH%"
set DATABASE_URL=file:./test.db
set API_PORT=4055
set CORS_ORIGINS=http://localhost:5299,http://127.0.0.1:5299
REM ts-node, NOT `nest start`. `nest start` compiles into apps\api\dist, which is
REM the LIVE server's own build artefact; recompiling it mid-session trips the
REM keepalive into restarting production. That has caused a real outage before.
cd /d "%~dp0..\apps\api"
call npx ts-node --project tsconfig.json -r tsconfig-paths/register src/main.ts
