@echo off
setlocal
cd /d "%~dp0mobile-app"
if not exist node_modules (
  npm install
)
npm start
