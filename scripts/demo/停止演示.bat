@echo off
rem ============================================================
rem  Stop the local demo environment.
rem  Use this only if the launcher window was closed with the X
rem  button (which skips the automatic clean shutdown).
rem ============================================================
chcp 65001 >nul
title Stop Demo
cd /d "%~dp0"

echo.
echo   Stopping the demo environment ...
echo.

rem 1) Ask MariaDB to shut down cleanly so the data files stay healthy.
if exist "mariadb\bin\mariadb-admin.exe" (
  "mariadb\bin\mariadb-admin.exe" --defaults-file="%~dp0mariadb\my.ini" -u root shutdown >nul 2>nul
)

rem 2) Terminate any leftover processes recorded by the launcher.
if exist "run\pids.txt" (
  for /f "tokens=1,2" %%a in (run\pids.txt) do (
    taskkill /F /PID %%b >nul 2>nul
  )
  del /q "run\pids.txt" >nul 2>nul
)

echo   Done. All demo processes have been stopped.
echo.
rem 用 ping 代替 timeout：timeout 在输入被重定向时会直接报错退出
ping -n 3 127.0.0.1 >nul
