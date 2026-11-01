@echo off
REM Starts Navi when Windows logs on. Point Task Scheduler at this file.
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on PATH.
  exit /b 1
)
node server.js
