@echo off
chcp 65001 >nul
title Smart Second-hand Platform - Defense Demo
cd /d "%~dp0"
setlocal EnableDelayedExpansion

rem ============================================================
rem  CONFIG -- edit only these lines before the defense.
rem  Every value can also be overridden by an env var of the same name.
rem
rem  DEMO_TUNNEL       cpolar | natapp | none
rem                    none = PANEL MODE (recommended here): cpolar already
rem                    runs as a background service on this machine, so the
rem                    script must NOT start a second client process.
rem  DEMO_FIXED_URL    reserved fixed HTTPS address. Kept OUT of this file
rem                    so the address is not exposed in the public repo --
rem                    put it in demo-config.local.bat (git-ignored) instead,
rem                    or set the env var of the same name.
rem                    Copy the address EXACTLY as the dashboard shows it.
rem                    Free random domains may carry a region prefix ".r2.";
rem                    reserved subdomains normally do not.
rem  DEMO_TUNNEL_EXE   full path to cpolar.exe / natapp.exe if not in PATH
rem  DEMO_PORT         must match the local port the tunnel points at
rem  DEMO_QR           1 = show QR code (needs: pip install "qrcode[pil]")
rem  DEMO_ALLOW_PUBLIC 1 = also allow Public firewall profile (campus WiFi)
rem  DEMO_REAL_AI      1 = use the real DeepSeek model (needs network + API key).
rem                    Model timeout / rate-limit / offline falls back to local
rem                    rules automatically, so the demo still works.
rem                    0 = local rules only (offline, no API quota used)
rem ============================================================
rem Machine-local overrides first (git-ignored), so they beat the defaults
rem below. Create demo-config.local.bat next to this file to set
rem DEMO_FIXED_URL without exposing a private address in the public repo.
if exist "%~dp0demo-config.local.bat" call "%~dp0demo-config.local.bat"
rem ============================================================
if not defined DEMO_TUNNEL       set "DEMO_TUNNEL=none"
if not defined DEMO_FIXED_URL    set "DEMO_FIXED_URL=https://YOUR-SUBDOMAIN.cpolar.top"
if not defined DEMO_TUNNEL_EXE   set "DEMO_TUNNEL_EXE="
if not defined DEMO_PORT         set "DEMO_PORT=3000"
if not defined DEMO_QR           set "DEMO_QR=1"
if not defined DEMO_ALLOW_PUBLIC set "DEMO_ALLOW_PUBLIC=1"
if not defined DEMO_REAL_AI      set "DEMO_REAL_AI=1"
if not defined DEMO_EXTRA_ARGS   set "DEMO_EXTRA_ARGS="
if not defined DEMO_NO_PAUSE     set "DEMO_NO_PAUSE=0"
rem ============================================================

rem Command-line args take priority: e.g. start-defense-demo.bat -Cleanup
if not "%~1"=="" (
  set "ARGS=%*"
  goto :run
)

set "ARGS=-Port !DEMO_PORT!"
if /i "!DEMO_ALLOW_PUBLIC!"=="1" set "ARGS=!ARGS! -AllowPublic"
if /i not "!DEMO_TUNNEL!"=="none" set "ARGS=!ARGS! -Tunnel !DEMO_TUNNEL!"
if not "!DEMO_TUNNEL_EXE!"=="" set ARGS=!ARGS! -TunnelExe "!DEMO_TUNNEL_EXE!"
if /i "!DEMO_QR!"=="1" set "ARGS=!ARGS! -Qr"
if /i "!DEMO_REAL_AI!"=="1" set "ARGS=!ARGS! -RealAI"

rem Placeholder guard: never let a fake URL reach the slides / QR code.
if "!DEMO_FIXED_URL!"=="" goto :placeholder
echo(!DEMO_FIXED_URL! | findstr /i /c:"YOUR-SUBDOMAIN" /c:"YOUR_DOMAIN" /c:"EXAMPLE" >nul
if not errorlevel 1 goto :placeholder
set ARGS=!ARGS! -PublicUrl "!DEMO_FIXED_URL!"
goto :url_done

:placeholder
set "DEMO_PUBLIC_URL="
rem Pure-LAN mode: no public link is expected, so no notice is needed.
if /i "!DEMO_TUNNEL!"=="none" goto :url_done
echo.
echo   [NOTICE] Fixed public URL is NOT set yet.
echo            The public link will be auto-detected from the client log
echo            and is usually a TEMPORARY random domain.
echo            Do NOT put it into your PPT or a printed QR code.
echo            Edit DEMO_FIXED_URL in this .bat once you reserve a domain.
echo.

:url_done
if not "!DEMO_EXTRA_ARGS!"=="" set "ARGS=!ARGS! !DEMO_EXTRA_ARGS!"

:run
echo   Launching: scripts\demo\start-lan-demo.ps1 !ARGS!
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo\start-lan-demo.ps1" !ARGS!
set "RC=!ERRORLEVEL!"

if /i "!DEMO_NO_PAUSE!"=="1" exit /b !RC!
if not "!RC!"=="0" (
  echo.
  echo   [ERROR] Startup failed ^(exit !RC!^). See messages above.
)
echo.
echo   Press any key to close this window...
pause >nul
exit /b !RC!
