@echo off
echo Starting Skill Check Website...
cd /d "%~dp0"
call code .
echo Launching Local Server...
call npm run dev
pause