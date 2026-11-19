# MyPro — Session Handoff

What the last session changed. `docs/PHASES.md` is the durable plan; this file
is volatile. Read `AGENTS.md` too.

## This session: the local agent connection, and Phase 16.1 (commitments)

Two things. First, the web app could not reach `backend-local` when run
locally. Second, the first slice of Phase 16 — commitments, the open loops the
companion tracks — is now built end to end across all four corners.

### Fix: the frontend could not connect to the local agent

The web app discovers the laptop's URL from `node_status.base_url`, which the
agent heartbeats from `PUBLIC_BASE_URL`. With no Cloudflare tunnel (plain local
dev) that is blank, so discovery returned nothing and `resolveAgentBase` threw
`AgentOfflineError` — the assistant looked permanently offline.

- `frontend/src/lib/client.ts` now defaults `agentUrl` to
  `http://localhost:8787/api/v1` when `VITE_AGENT_URL` is blank **and**
  `import.meta.env.DEV` is true. Production builds (DEV=false) are untouched and
  still discover through render. `frontend/.env` stays blank, with its comment
  updated to explain the dev behaviour.
- Verified: `backend-local` boots, a CORS preflight from `http://localhost:8443`
  returns `204` with `Access-Control-Allow-Origin: http://localhost:8443`, and
  an unauthenticated GET returns `401` (reachable, needs a token). The
  logged-in browser round trip is the one thing a sandbox cannot do — that is
  yours to confirm.

### Phase 16.1 — commitments (open loops)

A commitment is a thing the user said they'd do, with a believed deadline and a
state the companion follows up on — distinct from a task (a checkbox).

- **Migration `supabase/migrations/0009_commitments.sql`** — the `commitments`
  table: `kind` (promise|goal|decision|intention), `due_at`, `confidence`,
  `state` (open|at_risk|done|slipped|abandoned), `source_message_id`,
  `next_checkin_at`, resolved_at, with default-deny owner RLS and a
  `set_updated_at` trigger. **Apply it by hand in the Supabase SQL editor** —
  nothing works until you do. (A commit does not run migrations.)
- **backend-render** `src/commitments/commitments.module.ts` — CRUD
  (`GET/POST/PATCH/DELETE /commitments`), mirroring tasks, registered in
  `app.module.ts`. This is the always-on read/write path so the web/app see
  commitments with the laptop asleep. Reaching a terminal state stamps
  `resolved_at`; reopening clears it.
- **backend-local** three skills in `src/skills/definitions.ts`:
  `list_commitments` (read), `create_commitment` (write), `update_commitment`
  (write). The agent records a loop the moment it hears "I need to finish this
  by Friday", and can mark it done / at-risk / slipped.
- **shared** `api.commitments.*` and the `CommitmentRow` / `CommitmentKind` /
  `CommitmentState` types.
- **frontend** a new **Commitments** section: `lib/useCommitments.ts` +
  `components/commitments/CommitmentsView.tsx`, wired into `App.tsx` (View type,
  VIEWS, NOTIFICATION_VIEWS, navItems, the render switch). Open loops sorted
  live-first; inline add; mark done / flag at-risk / reopen / delete. Reuses the
  existing shell classes, no new CSS.
- **Tests** `backend-local/test/commitment-skills.test.ts` — the three skills
  are registered with the right side-effect tier and their schemas accept valid
  input and reject bad (empty title, unknown kind/state, missing id).

**What 16.1 still needs (deliberately deferred):** nothing fires on
`next_checkin_at` yet — it is stored but not acted on. The derived check-in
("you said Friday, it's Wednesday, nothing's blocked — want tomorrow 9–11?") is
the moment that makes this feel like a companion, and it wants the laptop drain
loop (`backend-local/src/scheduler/`) to scan live commitments on its tick.
That is the seam into Phase 16.3's Pulse. Also unbuilt: `commitment_evidence`
(links to the calendar/email/annotation that show progress) and
`attention_threads`.

### Before any of this works for real

1. **Apply `0009_commitments.sql`** in the Supabase dashboard.
2. **Deploy backend-render** (push to `main` → Render auto-deploys), or run it
   locally and point `VITE_API_URL` at it — the production Render does not have
   the `/commitments` module until it is deployed. The agent skills write to
   Supabase directly, so once the migration is applied they work against the
   locally-running laptop immediately.
3. Log in on the web and try it: tell the assistant "remind me I promised to
   finish the report by Friday", then open Commitments.

## Verified this session

- All four packages pass `npx tsc --noEmit`.
- Unit tests green: shared 14, backend-render 17, backend-local 14 (recurrence
  + the new commitment-skill suite), frontend 4 — **49 total**.
- The web dev server builds and loads with the new view wired in, no console
  errors (so the new imports resolve). Behind the login guard, so the
  Commitments UI itself was not exercised signed-in.
- The local agent connection (CORS + reachability), as above.

Not verified (a sandbox cannot): anything signed-in, the commitment round trip
through a real browser, and the migration (not applied here).

## Still true from earlier sessions

- Web: `https://mypro-by-gova.vercel.app` · Render:
  `https://mypro-km2k.onrender.com` (base `/api/v1`) · Supabase ref
  `kssucdvrfzbdkyzovmjo`.
- Auth is **brokered by Render**; clients hold no Supabase credentials except
  the publishable key served at runtime by `GET /me/realtime`.
- Tests run on **Vitest**: `pnpm --dir shared test`, `pnpm --dir frontend test`,
  and `npm test` in each backend. Backend tests live in `test/`.
- `performSupabaseUpload` in `utils/pdfStorage.ts` is **still a fake progress
  simulator** — only extracted JSON really syncs, never the raw PDF.
- pdfjs runs without CMaps, so CJK PDFs may extract poorly.
- Images are Git LFS, except `frontend/public/*.png`.
- A test item "API Test Book" sits in the real library; Library has no delete UI.
- Commit only when asked, and use the co-author line your session's own
  attribution specifies.
