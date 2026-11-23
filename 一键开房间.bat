@echo off
chcp 65001 >nul
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请先安装：https://nodejs.org/
  pause
  exit /b 1
)
echo.
echo  正在开启局域网房间，浏览器将自动打开…
echo  关闭本窗口（或按 Ctrl+C）即结束房间。
echo.
node server\server.mjs
pause