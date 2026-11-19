# MyPro — Session Handoff

What the last session changed. `docs/PHASES.md` is the durable plan; this file
is volatile. Read `AGENTS.md` too.

## This session: connection verified, then the assistant upgraded toward a companion

Three threads: (1) verified the full web ↔ laptop-agent chain end to end and
fixed the two bugs that broke it; (2) built Phase 16.2 **memory** so the agent
knows you across sessions; (3) built the first slice of Phase 16.3 **proactive
check-ins** so it speaks unprompted. Everything typechecks; backend-local has
19 unit tests (recurrence + commitment + memory skills), all green.

### Connection chain — verified working

A message sent from the live web app reached backend-local and got a reply
(`"Hello"` → `"Hey! What's up?"`). Two real bugs fixed along the way:

- **`start-agent.bat` never captured the tunnel URL.** Its old `timeout`-based
  log-scrape silently produced a blank `Public URL`, so the agent booted with
  an empty `PUBLIC_BASE_URL` and heartbeat `node_status.base_url = null` —
  nobody could discover the laptop. Rewrote it to read the hostname from
  cloudflared's **metrics API** (`--metrics 127.0.0.1:20789` →
  `/quicktunnel`), use `ping` as the sleep (`timeout` errors on redirected
  stdin), always rebuild (no stale `dist`), and refuse to start if the port is
  busy. **`start-agent.bat` is committable and should be kept.**
- **Agent CORS didn't allow the production origin.** `backend-local/.env`
  `CORS_ORIGINS` listed only localhost, so the live app's request was
  browser-blocked. Added `https://mypro-by-gova.vercel.app`. (`.env` is
  gitignored — this is machine config, not a repo change.)
- Earlier dev fix still in place: blank `VITE_AGENT_URL` auto-targets
  `http://localhost:8787/api/v1` in `vite dev` (`frontend/src/lib/client.ts`).

Operational rule learned: **only ever run one agent.** A stray/`npm run dev`
instance heartbeats `base_url: null` every 30s and overwrites a good URL; the
new port guard enforces one.

### Phase 16.2 — memory (it knows you)

- `0010_narrative_memory.sql` — `narrative_snapshots` (immutable, owner RLS).
  **Apply by hand.** Semantic facts already live in `assistant_memory` (0001).
- `AssistantService.memoryContext` reads the top facts (by confidence, then
  last_used_at) + the latest narrative and injects both into **every** prompt
  (`systemPrompt` grew a memory section). Facts are framed as background, not a
  script to recite.
- New agent skills `remember` / `forget` (`skills/definitions.ts`) — upsert /
  delete a durable fact by key, so it learns as you talk.
- `SchedulerService.narrativeRefresh` (hourly cron) regenerates a ~250-word
  third-person sketch when the latest snapshot is >7 days old, from recent
  messages + open commitments + reading. Skips users with no data (won't invent
  a life). Degrades quietly on model failure.

### Phase 16.3 — proactive check-ins (it speaks first)

- `SchedulerService.commitmentCheckins` (30-min cron) acts on
  `commitments.next_checkin_at`: for live loops that are due, it writes a
  contextual nudge (LLM over the commitment + upcoming events + memory,
  degrading to a plain line) as a chat message **and** a `kind:'checkin'`
  notification, then advances `next_checkin_at` (≈ halfway to the deadline, min
  6h; daily if overdue) and flags an overdue open loop `at_risk`.
- Restraint: a **daily budget of 3** per user (counts `kind:'checkin'`
  notifications since UTC midnight) + the per-commitment cooldown. Only runs
  for `proactive_enabled` personas.

**What's deferred (next steps for 16):** episodic conversation summaries and
confidence *decay* for facts (16.2); the full Pulse scoring across many signal
types and the recorded *suppressed* log (16.3); attention threads and the
rhythm/register layer (16.1/16.4).

### Before any of this runs for the user

1. **Apply migrations by hand** in Supabase: `0009_commitments.sql` and
   `0010_narrative_memory.sql` (plus any still-pending `0005`–`0008`).
2. **Rebuild + restart the laptop agent** (`start-agent.bat`) — the running
   agent is on the old build until then. The crons only run with
   `SCHEDULER_ENABLED=true` (default).
3. Deploy backend-render for the Commitments CRUD (push to `main`), or run it
   locally.

## Verified this session

- All four packages pass `npx tsc --noEmit`.
- Unit tests: shared 14, backend-render 17, backend-local 19, frontend 4.
- The live web ↔ agent round trip (message delivered + answered).
- Not verified (sandbox / needs the running stack): the memory injection,
  narrative generation, and a real proactive check-in firing — these need the
  rebuilt agent + migrations applied, and time to pass.

## Still true from earlier sessions

- Web: `https://mypro-by-gova.vercel.app` · Render:
  `https://mypro-km2k.onrender.com` (base `/api/v1`) · Supabase ref
  `kssucdvrfzbdkyzovmjo`.
- Tests run on **Vitest**: `pnpm --dir shared|frontend test`, `npm test` in
  each backend; backend tests live in `test/`.
- Auth is brokered by Render; clients hold no Supabase credentials except the
  publishable key from `GET /me/realtime`.
- `performSupabaseUpload` in `utils/pdfStorage.ts` is still a fake progress
  simulator — only extracted JSON syncs, never the raw PDF.
- Commit only when asked; use the co-author line your session's attribution
  specifies.
