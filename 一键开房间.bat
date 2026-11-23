@echo off
chcp 65001 >nul
title Neon Snake 3D - LAN Room
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please install it from https://nodejs.org/
  echo.
  pause
  exit /b 1
)
echo.
echo   Neon Snake 3D - LAN room
echo   The browser will open automatically.
echo   Keep this window open while playing; close it to stop the room.
echo.
node server\server.mjs
echo.
echo   Room stopped. Press any key to close.
pause >nul
