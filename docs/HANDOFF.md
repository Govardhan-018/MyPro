# MyPro — Session Handoff

What the last session changed. `docs/PHASES.md` is the durable plan; this file
is volatile. Read `AGENTS.md` too.

## This session: Phase 16 completed — the assistant is now a companion (code)

All four parts of Phase 16 are implemented and unit-tested. The agent now
carries memory across sessions, decides on its own when to speak (with
restraint), and adapts its register. **74 unit tests green, all four packages
typecheck.** What has *not* happened is a live run — it needs migrations
applied and the agent rebuilt (see "Before it runs live").

Earlier this session (already committed): the web ↔ agent connection fix
(`start-agent.bat` tunnel-URL capture via cloudflared's metrics API; CORS; the
dev `VITE_AGENT_URL` fallback) and the first cut of 16.1/16.2/16.3.

### 16.1 — commitments + attention threads
- `commitments` (`0009`): CRUD on render (`/commitments`), agent skills, a web
  Commitments section; `next_checkin_at` auto-armed on a deadline.
- `attention_threads` (`0011`): `open_thread` / `close_thread` skills; active
  threads injected into every prompt.

### 16.2 — memory layers (full)
- Facts (`assistant_memory`) injected every prompt, now with **decay**
  (`src/memory/decay.ts`): a fact unused past a ~45-day half-life fades below a
  floor and drops out; `remember` resets its clock. `remember`/`forget` skills.
- **Narrative** (`0010` + `SchedulerService.narrativeRefresh`, hourly): a
  ~250-word third-person sketch regenerated weekly.
- **Episodic** (`memory_episodes`, `0011` + `SchedulerService.episodeRefresh`,
  6-hourly): one sentence summarising each new stretch of ≥16 messages.
- Everything assembled in `AssistantService.memoryContext` and injected by
  `systemPrompt`.

### 16.3 — the Pulse (`src/pulse/`)
- `PulseService` (30-min cron) replaces the old one-off commitment check-in and
  inactivity nudge (both removed from `SchedulerService`). It gathers candidate
  signals — `commitment`, `task`, `email`, `silence`, `evening`, `weekly` —
  scores each **urgency × value × novelty** (`pulse/scoring.ts`), and sends only
  those that clear a min score, a per-signal **cooldown**, and a **daily budget
  of 3**. Novelty decays from when each signal last fired.
- Every candidate — sent or suppressed and why — is written to `interventions`
  (`0011`). That's the suppressed log ("what did you decide not to tell me
  today?"), and the tuning surface.

### 16.4 — register + rhythm
- **Register** (`src/assistant/register.ts`): derived from the situation
  (health → serious, at-risk → concerned, deadline → focus, win → celebratory,
  else casual), injected as one prompt line.
- **Rhythm**: the evening close-out and Sunday letter are two Pulse signals
  gated on the user's local time.

### Tests (this is the "test the AI" layer)
New backend-local suites for the pure AI logic: `pulse-scoring` (score, novelty
decay, the three gates, ranking), `memory-decay` (effective confidence, fading,
live-fact selection), `register` (derivation precedence). Plus the existing
recurrence / commitment-skill / memory-skill suites. 39 in backend-local, 74
total. The pure logic that decides what the companion knows and whether it
speaks is covered; the LLM-in-the-loop behaviour is not (can't be, headless).

## Before it runs live (your steps)
1. **Apply migrations by hand** in Supabase: `0009_commitments.sql`,
   `0010_narrative_memory.sql`, `0011_companion.sql` (plus any still-pending
   `0005`–`0008`).
2. **Rebuild + restart the agent** (`start-agent.bat`) — it's on the old build.
   Crons run with `SCHEDULER_ENABLED=true` (default).
3. Deploy backend-render (push `main`) for the Commitments CRUD.

### How to see each piece work (once live)
- **Memory:** tell the assistant "remember I prefer deep work before noon",
  then open a fresh chat and ask what it knows — it should use it without being
  told. Then "forget that".
- **Commitment + Pulse:** say "I promised to send the report by tomorrow 5pm";
  it should record a commitment, and within the day a check-in should appear in
  chat + as a notification. Overdue → it flags `at_risk`.
- **Suppressed log:** query `interventions` — you'll see sent rows and
  suppressed ones with `suppressed_reason`.
- **Narrative/episodic:** accumulate some conversation; `narrative_snapshots`
  and `memory_episodes` fill on their crons (hourly / 6-hourly).

## Verified this session
- All four packages `npx tsc --noEmit`.
- Unit tests: backend-local 39, backend-render 17, shared 14, frontend 4 = 74.
- Not verified (needs live stack + model + time): memory injection, decay,
  narrative/episodic generation, any Pulse signal firing, register in a real
  reply. All headless-impossible.

## Still true from earlier sessions
- Web `https://mypro-by-gova.vercel.app` · Render `https://mypro-km2k.onrender.com`
  (`/api/v1`) · Supabase ref `kssucdvrfzbdkyzovmjo`.
- Tests: Vitest — `pnpm --dir shared|frontend test`, `npm test` in each backend;
  backend tests in `test/`.
- Auth brokered by Render; clients hold no Supabase creds except the publishable
  key from `GET /me/realtime`.
- `performSupabaseUpload` in `utils/pdfStorage.ts` is still a fake progress
  simulator — only extracted JSON syncs, never the raw PDF.
- Commit only when asked; use the co-author line the session's attribution gives.
