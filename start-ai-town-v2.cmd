@echo off
setlocal
cd /d "%~dp0"
start "" "http://localhost:8788/"
node ai-town-v2-server.js
