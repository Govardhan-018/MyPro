# backend-local

Your personal agent. Runs on your laptop — the only machine that holds the
model API key (Google AI Studio / Gemini). Serves the assistant directly to
the web app (and later the Android app), reads/writes Supabase itself, and
heartbeats so everything else knows when it is awake.

**Owns:** `/assistant/*` (continuous chat, context-window setting,
clear/archive, runtime settings, persona/charter) and
`/internal/ai/complete` (render asks it to write scheduled briefs —
shared-secret only, never a browser).

Close the laptop → heartbeat goes stale in ~90s → the UI greys the
assistant out and render degrades AI jobs to plain messages. Open it →
everything resumes. No cleanup, no state to repair.

## Run

```bash
cp .env.example .env   # fill in — refuses to boot otherwise
npm install
npm run build
npm start              # http://localhost:8787/api/v1  (liveness: /api/v1/healthz)
```

(`npm run dev` for watch mode while developing.)

## Normal use: `start-agent.bat` (no domain needed)

From the repo root, double-click **`start-agent.bat`**. It:

1. opens a **Cloudflare quick tunnel** — free, no account, no domain;
2. scrapes the `https://….trycloudflare.com` URL it prints;
3. starts this agent with that as `PUBLIC_BASE_URL`.

The agent heartbeats `PUBLIC_BASE_URL` into Supabase (`node_status`) every
30 seconds, and **render and the web app read the address from there** — so
the URL changing on every start costs nothing. No redeploys, no env edits.

One-off prerequisite:

```powershell
winget install --id Cloudflare.cloudflared
```

Quick tunnels are best-effort (Cloudflare gives no uptime guarantee) and the
hostname is random each run. That is fine here precisely because discovery is
dynamic. If you later buy a domain, create a *named* tunnel and set a fixed
`PUBLIC_BASE_URL` instead — everything else keeps working unchanged.

## The model

Google AI Studio (Gemini), free tier: <https://aistudio.google.com/apikey>.
Set `GEMINI_API_KEY` in `.env`; `ASSISTANT_MODEL` defaults to
`gemini-3.8-flash` and is overridable per user in `assistant_settings.model`.

`src/llm/llm.service.ts` is the only file that knows which vendor is in use —
it converts JSON Schema to Gemini's stricter subset and normalises function
calls, so swapping providers means replacing that one file.
