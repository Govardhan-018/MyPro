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

if not exist "dist\main.js" (
  echo [*] No build found - building...
  call npm run build || (echo [!] Build failed. & pause & exit /b 1)
)

set "PORT=8787"
set "TUNNEL_LOG=%TEMP%\mypro-tunnel.log"
if exist "%TUNNEL_LOG%" del /q "%TUNNEL_LOG%"

echo [*] Opening Cloudflare tunnel to http://localhost:%PORT% ...
start "MyPro Tunnel" /min cmd /c "cloudflared tunnel --no-autoupdate --url http://localhost:%PORT% > ""%TUNNEL_LOG%"" 2>&1"

REM --- wait for the URL to appear (up to ~40s) ---------------------------
set "TUNNEL_URL="
for /l %%i in (1,1,40) do (
  if not defined TUNNEL_URL (
    timeout /t 1 /nobreak >nul
    for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command ^
      "if (Test-Path '%TUNNEL_LOG%') { (Select-String -Path '%TUNNEL_LOG%' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches ^| Select-Object -First 1).Matches.Value }"`) do (
      set "TUNNEL_URL=%%U"
    )
  )
)

if not defined TUNNEL_URL (
  echo [!] Could not read a tunnel URL from %TUNNEL_LOG%
  echo     Check that log, then try again.
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
