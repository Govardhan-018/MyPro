# Moving the agent off the laptop

**What changes.** `backend-local` stops being local. It becomes a second
Render web service, `mypro-agent`, alongside `mypro-core`. The Cloudflare
quick tunnel and `start-agent.bat` stay, but only for local development.

**What this buys.** The assistant answers when your laptop is shut, and the
clock — the drain loop, the Pulse, the narrative and episode refreshes, the
email summaries — runs whether or not you are at your desk. That was the
whole reason the Pulse existed and the main thing the laptop could not do.

**What it costs.** Three things, stated plainly before you start:

1. **`GROQ_API_KEY` leaves your machine.** Until now the model key existed on
   exactly one computer, and `AI_SYSTEM.md` said so as a design property. It
   now sits in Render's environment. So does the Web Push private key. This
   is a real reduction in the blast radius guarantee, traded for an agent
   that is actually awake.
2. **Free instance hours are pooled** (~750/month at the time of writing —
   check your own dashboard, the number moves). One service resident around
   the clock is ~730. You can keep **one** of the two awake, not both.
3. **Cold starts.** The core will sleep. The first screen after a quiet
   period waits ~30 seconds for it.

If any of that is unacceptable, the honest alternative is at the bottom.

---

## 1. Deploy the service

The blueprint already describes both services. Render → **New → Blueprint** →
this repo → apply. It reads `render.yaml` and creates `mypro-agent` with
`rootDir: backend-local`.

If `mypro-core` already exists from an earlier blueprint, Render will adopt it
rather than duplicating it.

## 2. Set the secrets

In the Render dashboard, on **mypro-agent**:

| Variable | Value |
|---|---|
| `SUPABASE_SECRET_KEY` | the `sb_secret_…` key |
| `INTERNAL_SERVICE_TOKEN` | **byte-identical** to mypro-core's |
| `GROQ_API_KEY` | from console.groq.com |
| `CORS_ORIGINS` | your Vercel origin(s), comma separated |
| `RENDER_API_URL` | `https://<core-host>/api/v1` |
| `PUBLIC_BASE_URL` | `https://mypro-agent.onrender.com` — origin only, **no** `/api/v1` |
| `WEB_PUSH_PUBLIC_KEY` / `WEB_PUSH_PRIVATE_KEY` / `WEB_PUSH_SUBJECT` | the VAPID pair |

Optional, for research: `GUARDIAN_API_KEY` (free, instant, ~12,000/day — the
one worth getting), `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`,
`NEWS_RSS_FEEDS`.

Two that are set for you by the blueprint and must not be changed:
`SCHEDULER_ENABLED=true` here, and `SCHEDULER_ENABLED=false` on the core.
**Two schedulers race for the same rows and double-send everything.**

> `PUBLIC_BASE_URL` is wrong far more often than anything else here. The web
> app reads it out of `node_status` and appends `/api/v1` itself, so a value
> ending in `/api/v1` produces 404s on every assistant call. Verify after the
> first deploy: `select base_url from node_status where node = 'local';`

## 3. Keep it awake

Render free sleeps after ~15 minutes idle. Supabase wakes it.

In the Supabase SQL editor, add the agent's URL to the Vault:

```sql
select vault.create_secret(
  'https://mypro-agent.onrender.com/api/v1/internal/keepalive',
  'agent_keepalive_url',
  'MyPro agent keep-alive endpoint');
```

Then run `supabase/migrations/0016_keepalive_agent.sql`. It schedules a ping
every 10 minutes and **unschedules the core's ping**, because the hours do not
stretch to both.

Check it after twenty minutes:

```sql
select service, created_at, outcome, status_code
  from service_pings order by created_at desc limit 10;
```

## 4. Point the web app at it

Nothing to do, if you leave `VITE_AGENT_URL` empty: the app discovers the
agent through `node_status`, which the agent heartbeats every 30 seconds.
That indirection was built for the ephemeral tunnel and it works just as well
for a fixed Render URL.

Setting `VITE_AGENT_URL=https://mypro-agent.onrender.com/api/v1` skips the
lookup. It is slightly faster and one more thing to change later; the
discovery path is the better default.

## 5. Check it worked

```sql
select node, base_url, last_heartbeat_at, now() - last_heartbeat_at as stale
  from node_status;
```

Both nodes should appear, `local` (the agent) going stale by no more than
~30 seconds. Then open the app: the assistant should not be greyed out, and a
message should get a reply. Finally, confirm the clock is running — the
keep-alive reports it:

```powershell
curl -X POST https://mypro-agent.onrender.com/api/v1/internal/keepalive -H "x-internal-token: <INTERNAL_SERVICE_TOKEN>"
```

`{"status":"ok","scheduler":true}` means the drain loop is alive.

## 6. Local development afterwards

Unchanged. `npm run dev` in `backend-local/` still works, and in `vite dev` a
blank `VITE_AGENT_URL` auto-targets `http://localhost:8787/api/v1`.

One trap: if you run the agent locally **while** the Render one is live, both
heartbeat into `node_status` and both drain the same schedules — the double-send
this whole setup is arranged to prevent. For local work either set
`SCHEDULER_ENABLED=false` in `backend-local/.env`, or suspend the Render
service while you work.

---

## The alternative, if the hours do not work

Merge the two services into one deployable. The agent's modules are ordinary
Nest modules; `backend-render` could import them directly, and then there is
one service, one set of hours, one scheduler and no node-to-node hop for mail
or Strava at all.

The reason the repo is not already shaped that way is that the split was built
when the model key had to stay on a personal machine. Once that constraint is
gone — and moving to Render is exactly giving it up — the two-service topology
is paying a cost for a guarantee it no longer provides. Worth doing if free
hours start biting; not worth doing today just for tidiness.
