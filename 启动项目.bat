@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
start "Pavo Agnes Bridge" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\agnes_proxy.ps1"
start "Pavo API Entry" /min cmd /c "npm run api:entry"
start "Pavo Studio" http://127.0.0.1:5188
call npm run dev -- --host 127.0.0.1 --port 5188
