@echo off
setlocal EnableDelayedExpansion
title MyPro Agent

REM ===================================================================
REM  Starts the personal agent with a public HTTPS address.
REM
REM  1. Opens a Cloudflare quick tunnel (no domain, no account needed).
REM  2. Scrapes the https://....trycloudflare.com URL it prints.
REM  3. Starts backend-local with that as PUBLIC_BASE_URL.
REM
REM  The agent heartbeats PUBLIC_BASE_URL into Supabase (node_status)
REM  every 30s, so render and the web app pick up the new address on
REM  their own. Nothing needs redeploying when the URL changes.
REM
REM  Requires: cloudflared  ->  winget install --id Cloudflare.cloudflared
REM ===================================================================

cd /d "%~dp0backend-local"

set "PORT=8787"

if not exist ".env" (
  echo [!] backend-local\.env is missing. Copy .env.example and fill it in.
  pause & exit /b 1
)

where cloudflared >nul 2>&1
if errorlevel 1 (
  echo [!] cloudflared not found.
  echo     Install it with:  winget install --id Cloudflare.cloudflared
  pause & exit /b 1
)

REM --- refuse to start if an agent is already on the port ----------------
REM  A second agent would bind-fail here, and a stale one keeps overwriting
REM  the tunnel URL in node_status with its own (often blank) address every
REM  30s, so the web app and render lose the laptop. Only ever run one.
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [!] Something is already listening on port %PORT%.
  echo     An agent is probably already running. Close it first, or find it with:
  echo         netstat -ano ^| findstr :%PORT%
  echo         taskkill /f /pid ^<the PID shown^>
  pause & exit /b 1
)

REM --- always build so the agent runs the current code, never stale dist --
echo [*] Building backend-local...
call npm run build || (echo [!] Build failed - fix the errors above, then retry. & pause & exit /b 1)
if not exist "dist\main.js" (
  echo [!] Build produced no dist\main.js. & pause & exit /b 1
)

set "TUNNEL_LOG=%TEMP%\mypro-tunnel.log"
if exist "%TUNNEL_LOG%" del /q "%TUNNEL_LOG%"
set "METRICS=127.0.0.1:20789"

echo [*] Opening Cloudflare tunnel to http://localhost:%PORT% ...
start "MyPro Tunnel" /min cmd /c "cloudflared tunnel --no-autoupdate --metrics %METRICS% --url http://localhost:%PORT% > ""%TUNNEL_LOG%"" 2>&1"

REM --- ask cloudflared's own metrics API for the hostname (up to ~40s) ---
REM  Reading the hostname from the metrics endpoint is far more reliable than
REM  scraping the human-readable log, whose format changes and races the write.
REM  `ping` is the sleep that works even when stdin is redirected; `timeout`
REM  errors out there, which is how a blank URL slipped through before. The
REM  https:// prefix is only added when a hostname actually came back, so an
REM  empty reply leaves TUNNEL_URL undefined and the guard below catches it.
set "TUNNEL_URL="
for /l %%i in (1,1,40) do (
  if not defined TUNNEL_URL (
    >nul ping -n 2 127.0.0.1
    for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command ^
      "try { $h = (Invoke-RestMethod -Uri 'http://%METRICS%/quicktunnel' -TimeoutSec 2).hostname; if ($h) { 'https://' + $h } } catch { }"`) do (
      set "TUNNEL_URL=%%U"
    )
  )
)

if not defined TUNNEL_URL (
  echo [!] Could not read a tunnel URL from %TUNNEL_LOG%
  echo     Check that log, then try again. Common cause: cloudflared could not
  echo     reach Cloudflare ^(network/firewall^), so it printed no URL.
  taskkill /f /im cloudflared.exe >nul 2>&1
  pause & exit /b 1
)

echo.
echo     Public URL : !TUNNEL_URL!
echo     Agent API  : !TUNNEL_URL!/api/v1
echo.
echo [*] Publishing this address to Supabase via the agent heartbeat...

set "PUBLIC_BASE_URL=!TUNNEL_URL!"
node dist/main.js

REM --- the agent stopped: take the tunnel down with it ------------------
echo.
echo [*] Agent stopped - closing tunnel.
taskkill /f /im cloudflared.exe >nul 2>&1
endlocal
