@echo off
setlocal
cd /d "%~dp0"
set "AI_TOWN_API_KEYS="
set "AI_TOWN_API_KEY="
set "OPENAI_API_KEY="
set "AI_TOWN_BASE_URL="
set "OPENAI_BASE_URL="
set "AI_TOWN_MODEL="
set "OPENAI_MODEL="
set "AI_TOWN_V2_HOST=0.0.0.0"
start "" "http://localhost:8788/"
node ai-town-v2-server.js
