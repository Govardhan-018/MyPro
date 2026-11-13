# MyPro — Roadmap

Where things stand and what happens next, ordered so nothing gets built twice.

---

## Done

- **Structure** — `frontend/` (Vercel) · `backend-render/` (always-on core) · `backend-local/` (laptop agent) · `supabase/` (migrations)
- **Database** — 4NF schema, default-deny RLS, database-enforced health consent gate, node presence, skill receipts
- **backend-render** — all CRUD endpoints (profile, library, reader, calendar, tasks, health, notifications, gmail, schedules), minute-tick scheduler, inactivity nudge, agent delegation with offline degradation. **Deployed and live.**
- **backend-local** — assistant chat, **21 skills** across every feature + Gmail, three permission tiers, receipts, approval queue. Groq (`openai/gpt-oss-120b`) tool-calling **verified live**.
- **Tunnel discovery** — `start-agent.bat` → quick tunnel → `node_status` → render + web both resolve it dynamically. No domain needed.

## Not done

The frontend still runs **entirely on in-memory state**. Nothing in the UI calls any endpoint. That is the gap.

---

## The decision that shapes the order

An Android app is coming. Almost everything the web app needs — the API client,
the types, auth, session handling, the agent-discovery logic — is **identical**
on Android. If we wire `App.tsx` with inline `fetch` calls now, all of it gets
rewritten for React Native later.

So: **extract the shared core first, then wire the web app on top of it.** The
Android app becomes a new UI over code that is already proven, instead of a
second implementation of the same logic.

That single reordering is worth more than anything else in this document.

---

## Phase 0 — Lock in what exists · *small, do first*

- [ ] **0.1** `git add` + commit the whole restructure (currently untracked — one bad `rm` loses it)
- [ ] **0.2** Deploy the frontend to Vercel (root directory = `frontend`)
- [ ] **0.3** Add the Vercel origin to `CORS_ORIGINS` on Render, redeploy (also picks up the CORS 500 fix)
- [ ] **0.4** Run `start-agent.bat` for real once; confirm the `trycloudflare.com` URL lands in `node_status.base_url`
- [ ] **0.5** Decide Render free vs Starter — free sleeps after ~15 min idle, which **stops the scheduler**, so no morning briefs overnight

## Phase 1 — Shared core · *the Android-critical one*

Extract into `shared/` (a workspace package both apps import):

- [ ] **1.1** `shared/types` — row types, generated from the schema where possible
- [ ] **1.2** `shared/api` — the typed client, moved out of `frontend/src/lib/api.ts`, with **platform injected** (fetch, storage, env) rather than importing Vite globals
- [ ] **1.3** `shared/auth` — Supabase session handling behind a storage adapter (`localStorage` on web, `AsyncStorage` on Android)
- [ ] **1.4** `shared/agent` — the `node_status` discovery + cache logic
- [ ] **1.5** Repoint `frontend/` at `shared/`, confirm it still builds

## Phase 2 — Real auth in the web app

- [ ] **2.1** Replace the prototype `Welcome` with Supabase auth (email/password + Google)
- [ ] **2.2** Session persistence, restore on load, sign-out
- [ ] **2.3** Route guard — no app shell without a session
- [ ] **2.4** `POST /me/activity` heartbeat on focus (this is what drives the inactivity nudge)
- [ ] **2.5** Create the first real user and confirm the signup trigger seeds profile/persona/settings/conversation

## Phase 3 — Wire the web features to the API

Replace in-memory state, screen by screen. Library first — annotations are the
most valuable thing currently being thrown away on refresh.

- [ ] **3.1** Library list + add/edit/delete against `/library`
- [ ] **3.2** **Reader annotations persist** — highlights, notes, bookmarks, sessions
- [ ] **3.3** My Knowledge reads `/knowledge` instead of deriving locally
- [ ] **3.4** Calendar + Tasks
- [ ] **3.5** Health records + the time-boxed assistant grant UI
- [ ] **3.6** Loading / error / offline states throughout (the laptop *will* be asleep sometimes)

## Phase 4 — Assistant UI · *the heart of the product*

- [ ] **4.1** Continuous chat against the agent (`VITE_AGENT_URL` or discovered)
- [ ] **4.2** **Receipt cards** — render `skill_invocations` inline: *"✓ Scheduled 'Deep work' Thu 9–11"*
- [ ] **4.3** Agent online/offline indicator from `/nodes/status`; disable input, explain why
- [ ] **4.4** Context-window slider, clear/archive chat
- [ ] **4.5** Persona/charter editor (name, tone, check-in time, inactivity hours)
- [ ] **4.6** Pending-approvals queue for outward actions

## Phase 5 — Schedules UI

- [ ] **5.1** Visual builder: "report me every weekday at 08:30"
- [ ] **5.2** List, enable/disable, delete
- [ ] **5.3** Run history from `schedule_runs` (including `deferred` when the laptop was asleep)

## Phase 6 — Notifications that actually reach you

- [ ] **6.1** **Supabase Realtime** on `notifications` → in-app toast. One mechanism, works on web *and* Android.
- [ ] **6.2** Web Push (VAPID) for the browser
- [ ] **6.3** **Telegram bot** — the "texts me like a friend" channel; by far the easiest real push to a phone
- [ ] **6.4** Fan-out in `SchedulerService.notify` using `device_tokens` (currently a TODO)

## Phase 7 — Gmail

- [ ] **7.1** Google Cloud OAuth app + consent screen
- [ ] **7.2** Connect flow **in the frontend Settings section**, multiple accounts
- [ ] **7.3** Encrypt tokens at rest with `TOKEN_ENCRYPTION_KEY`
- [ ] **7.4** Sync worker on render: backfill, then incremental via `historyId`
- [ ] **7.5** `email_insights` generation via the agent
- [ ] **7.6** Make `send_email` really send, behind the existing approval gate

## Phase 8 — Android app

- [ ] **8.1** Expo scaffold in `android/` (or `mobile/`), importing `shared/`
- [ ] **8.2** Auth + session via AsyncStorage adapter
- [ ] **8.3** Core screens: Today, Library/Reader, Assistant
- [ ] **8.4** FCM push → `device_tokens`
- [ ] **8.5** Reader touch interactions (long-press selection already solved on web — the anchoring model ports)
- [ ] **8.6** Build an APK for your phone (EAS Build or local)

## Phase 9 — Companion intelligence

From `COMPANION_VISION.md`, in the order that changes how it *feels*:

- [ ] **9.1** **Commitments + threads** — "finish the project by Friday" becomes a tracked open loop with derived check-ins. Biggest jump in feeling like a companion.
- [ ] **9.2** **The Pulse** — signals scored `urgency × value × novelty`, daily budget, cooldowns, and a recorded *suppressed* log
- [ ] **9.3** **Memory layers** — episodic summaries, semantic facts with decay, the weekly narrative refresh
- [ ] **9.4** **Rhythm + register** — morning/evening/Sunday letter, derived tone, catch-up collapse when the laptop wakes

## Phase 10 — PDF pipeline

- [ ] **10.1** On-device extraction (`pdfjs-dist` on web)
- [ ] **10.2** Structured JSON → Supabase Storage; raw PDF stays local
- [ ] **10.3** Reader consumes real extracted text instead of sample data
- [ ] **10.4** Processing states + OCR status for scanned PDFs

---

## Suggested order

**0 → 1 → 2 → 4 → 3 → 6 → 5 → 7 → 8 → 9 → 10**

Phase 4 (Assistant UI) jumps ahead of finishing Phase 3 deliberately: the agent
already works and has 21 skills, so the assistant is the fastest route to
something you'd genuinely use every day. Phase 6 follows closely — a companion
that cannot reach your phone is only half built.

Android (8) sits after notifications so the app ships with push working, and
after the shared core (1) so it is a new UI rather than a second codebase.

## Standing risks

- **Render free tier sleeps** → scheduler stops → no overnight briefs
- **Quick-tunnel URLs are best-effort** — fine for personal use; a domain + named tunnel is the upgrade path
- **Groq model availability shifts** (`llama-3.3-70b-versatile` already vanished from the key) — `ASSISTANT_MODEL` is env-configurable for exactly this reason
- **Nothing is committed yet**
