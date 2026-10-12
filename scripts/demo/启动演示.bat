@echo off
rem ============================================================
rem  Smart Second-hand Trading Platform - Local Demo Launcher
rem  Double-click this file to start the demo environment.
rem  It starts the bundled directory-local Node + MariaDB,
rem  then opens the browser automatically. No setup required.
rem ============================================================
chcp 65001 >nul
title Smart Second-hand Platform - Demo
cd /d "%~dp0"

if not exist "node\node.exe" (
  echo.
  echo   [ERROR] node\node.exe not found.
  echo   Please copy the WHOLE folder from the USB drive, not a single file.
  echo.
  pause
  exit /b 1
)

if not exist "launcher.js" (
  echo.
  echo   [ERROR] launcher.js not found. Copy the whole folder again.
  echo.
  pause
  exit /b 1
)

"node\node.exe" launcher.js

rem Only keep the window open when the launcher failed, so errors stay readable.
if errorlevel 1 (
  echo.
  echo   Startup failed. Please read the messages above.
  echo.
  pause
)
