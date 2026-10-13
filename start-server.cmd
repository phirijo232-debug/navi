@echo off
title Navi Server
cd /d "%~dp0"
echo Starting Navi Server...
"C:\Program Files\nodejs\node.exe" server.js
pause
