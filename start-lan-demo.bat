@echo off
chcp 65001 >nul
title Smart Second Hand Platform - LAN Demo
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo\start-lan-demo.ps1" %*
if errorlevel 1 echo.& echo [ERROR] Startup failed. See messages above.
echo.
echo Press any key to close this window...
pause >nul
