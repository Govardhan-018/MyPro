# backend-render

The always-on half of MyPro. Deployed on Render (free/starter web service).

**Owns:** profile & activity heartbeat, library + collections, reader data
(annotations, bookmarks, sessions, knowledge), calendar, tasks, health records
+ consent grants, notifications & devices, Gmail accounts/messages, schedules,
and the **scheduler** (minute tick + inactivity nudge).

**Does not own:** the assistant. The web/app call the laptop
(`backend-local`) directly for `/assistant/*`. When a scheduled job needs
generated text, this service calls the laptop's internal endpoint; if the
laptop is asleep the job defers (10 min × 3) and then degrades to a plain
message, so your morning brief always arrives.

## Run locally

```bash
cp .env.example .env   # fill in — refuses to boot otherwise
npm install
npm run dev            # http://localhost:8080/api/v1  (liveness: /api/v1/healthz)
```

## Deploy on Render

The repo root has a `render.yaml` blueprint: Render → New → Blueprint →
point at this repo. It builds from `backend-render/` with
`npm install && npm run build` and starts `node dist/main.js`.
Set the env vars from `.env.example` in the dashboard. Health check path:
`/api/v1/healthz`.

> Free-tier note: Render free services sleep after idle. The scheduler needs
> the service awake — use the Starter plan, or an external pinger, if you
> stay on free.

Endpoint reference: `docs/BACKEND_PLAN.md` in the repo root.
