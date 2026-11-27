# MyPro

A private, single-user **personal operating system**: calendar, library and
reader, knowledge base, health records, schedules, mail — and an AI companion
that can act across all of them. One repository, three deployables, one
Postgres, one Android app that is a native shell around the web app.

> **Status (2026-11):** feature-complete for daily use. 549 automated tests
> pass across the four TypeScript packages; the web builds; the Android APK
> builds on every push to `main`. What is verified only in automation (not on
> a physical device or against live third-party services) is listed honestly
> in [§13](#13-verification-status-and-known-limits).

---

## Contents

1. [Architecture](#1-architecture)
2. [Repository layout](#2-repository-layout)
3. [Technology](#3-technology)
4. [Features](#4-features)
5. [The AI companion](#5-the-ai-companion)
6. [Data model](#6-data-model)
7. [API surface](#7-api-surface)
8. [Security model](#8-security-model)
9. [Reliability engineering](#9-reliability-engineering)
10. [Configuration](#10-configuration)
11. [Development, build, deploy](#11-development-build-deploy)
12. [Testing](#12-testing)
13. [Verification status and known limits](#13-verification-status-and-known-limits)
14. [Documentation index](#14-documentation-index)

---

## 1. Architecture

```
                         ┌──────────────────────────── Supabase ───────────────────────────┐
                         │ Postgres (4NF, RLS force/default-deny) · Auth (JWT, JWKS)        │
                         │ Storage (extracted book text) · Realtime (notifications) · pg_cron│
                         └───────────▲───────────────────────▲─────────────────▲────────────┘
                                     │ forUser(jwt) / admin  │ admin           │ Realtime (publishable
                                     │                       │                 │ key + user JWT)
 ┌───────────── clients ─────────────┴──┐      ┌─────────────┴──────────┐      │
 │ Web app (React 19, Vercel)           │─────▶│ mypro-core             │      │
 │  · everything except /assistant/*    │ HTTPS│ backend-render (NestJS)│      │
 │ Android (Expo WebView shell)         │      │ CRUD, auth broker,     │◀─────┘
 │  · loads the web app                 │      │ Gmail/Strava tokens,   │
 │  · native: alarm clock, push,        │      │ schedules/upcoming     │
 │    session bridge, deep links        │      └───────▲───────┬────────┘
 └──────────────┬───────────────────────┘    internal  │       │ internal (shared secret)
                │ /assistant/* (discovered URL)  secret │       ▼
                │                              ┌────────┴───────────────┐
                └─────────────────────────────▶│ mypro-agent            │
                                               │ backend-local (NestJS) │
                                               │ LLM, agent core, skills│
                                               │ research, Pulse, clock │
                                               └────────────────────────┘
```

| Deployable | Folder | Runs on | Responsibility |
|---|---|---|---|
| **Web** | `frontend/` | Vercel | The entire UI. React 19 + Vite + Tailwind v4. Service worker for offline launch and web push. |
| **Android** | `android/` | Phone (APK from GitHub Actions) | Expo SDK 52 `react-native-webview` shell around the web app. Native only for what a page cannot do: OS alarms, push, back button, deep links. |
| **Core** | `backend-render/` | Render (`mypro-core`) | Always-reachable request-driven API: auth broker, CRUD, calendar reminders, Gmail/Strava OAuth + encrypted tokens, `/schedules/upcoming`. Holds **no** model key. |
| **Agent** | `backend-local/` | Render (`mypro-agent`) or a laptop via Cloudflare tunnel | The companion: LLM, agent core, 37 skills, research, memory, the Pulse, and the **scheduler drain loop**. Holds the model keys, never an OAuth token. |
| **Database** | `supabase/` | Supabase cloud | 23 hand-applied migrations, RLS on every table, `pg_cron` keep-alive and retention. |
| **Shared core** | `shared/` | imported by web + Android | `@mypro/shared`: typed API client, auth/session engine, agent discovery, PDF text engine, notification mapping, Realtime stream. One implementation for both clients. |

**Routing rule.** Clients call the core for everything except `/assistant/*`
and `/skills/*`, which go directly to the agent.

**Discovery, never hardcoding.** The agent heartbeats its own public URL into
`node_status` (`node='local'`) every 30 s; the core and the web read it from
there. The core records its own API root in `node_status.detail.api_url`
(`node='render'`) on boot and on every keep-alive, so the agent finds the core
at its real host rather than trusting a hand-set `RENDER_API_URL`.

**One clock.** `SCHEDULER_ENABLED` is true on exactly one agent; two would
drain the same rows. On-time *firing* of reminders belongs to the phone's own
alarm manager, so reminders arrive with every server asleep.

**Zero recurring cost** is a design constraint: free tiers throughout, the
phone as the clock, Supabase `pg_cron` pinging Render to keep it awake.

---

## 2. Repository layout

```
frontend/
  src/App.tsx                    all views (Today, Calendar, Library, Knowledge, Health,
                                 Commitments, Schedules, Assistant, Settings), routing, shell
  src/components/assistant/      Markdown renderer, plan card, result blocks, character panel
  src/components/library/        PDF reader, podcast player, article reader, offline download
  src/components/schedules/      three-mode scheduler
  src/lib/                       api/auth glue, hooks (useLibrary, useCalendar, useSchedules,
                                 useGmail, useNotifications, usePush, useSession, …),
                                 outbox.ts (offline sync), offlineBooks.ts, knowledgeGroups.ts,
                                 readerCache.ts, shell.ts (native bridge), pdfEngine/pdfOcr
  public/sw.js                   service worker: precache + offline navigation + web push
android/
  App.tsx, src/ShellApp.tsx      WebView shell, message bridge, lifecycle
  src/lib/notifications.ts       the clock: channels, permission, arming, push registration
  app.json, app.config.js        Expo config; push credentials injected at build time
shared/src/
  auth.ts api.ts                 session engine, typed client with central 401 recovery
  pdf.ts pdfRemote.ts            PDF → structured JSON (blocks, TOC, OCR fallback), cloud copy
  notify.ts realtime.ts types.ts
backend-render/src/
  auth/ library/ calendar/ schedules/ gmail/ strava/ notifications/ health/
  tasks/ commitments/ interests/ profile/ nodes/ common/ config/
backend-local/src/
  agent/        orchestrator, intent router, planner, executor, verification, effort budgets
  assistant/    chat service, system prompt, register, internal AI endpoint
  capabilities/ routing metadata per skill
  skills/       the 37 skill definitions + executor + approvals
  llm/          provider-neutral model layer (Groq, Gemini, Cohere, SambaNova)
  research/     12 web/news/sports/weather providers behind chains, SSRF guard, cache
  memory/ pulse/ scheduler/ notifications/ gmail/ fitness/ presence/
supabase/migrations/             0001 … 0023 (applied by hand, in order)
docs/                            architecture contract, AI system, agent spec, phases, handoff
.github/workflows/android.yml    APK build (main only, Gradle cache, rate-limit retry)
render.yaml                      Render blueprint for mypro-core and mypro-agent
```

---

## 3. Technology

| Layer | Stack |
|---|---|
| Web | React 19, Vite 8 (rolldown), Tailwind CSS v4 (`@tailwindcss/vite`), lucide-react, framer-motion, lottie-react, pdfjs-dist 6, tesseract.js 6 (on-device OCR) |
| Android | Expo SDK 52, React Native 0.76, react-native-webview 13, expo-notifications 0.29, AsyncStorage |
| Backends | NestJS, zod (every input and every env var), `@nestjs/schedule`, supabase-js v2, jose (JWKS), luxon + cron-parser (recurrence), web-push, groq-sdk |
| Data | Supabase Postgres + RLS, Storage, Realtime, `pg_cron`, `pg_net` |
| AI | Groq (`openai/gpt-oss-120b` default), Gemini, Cohere, SambaNova — chosen per call by a model-name prefix, with a fallback chain |
| Tests | Vitest everywhere; Playwright for browser verification |
| CI/CD | GitHub Actions (APK), Vercel (web), Render (core + agent) |

---

## 4. Features

Each feature lists what it does, how, and where it lives.

### 4.1 Accounts and sessions
- **Brokered auth.** Clients hold no Supabase credentials. Email/password goes
  to `POST /auth/login|signup`; the core talks to Supabase and returns the
  session. Every API call carries the access token; both backends verify it
  against the project's JWKS.
- **Central expiry handling** (`shared/src/api.ts`, `auth.ts`). Any 401 →
  one shared refresh (concurrent 401s collapse into one) → retry. A rejected
  refresh token clears the session and fires `onSessionExpired` exactly once;
  the sign-in page says "Your session expired". Further calls short-circuit
  without touching the network. A *transient* refresh failure is a 503, never a
  logout.
- **Races closed:** an epoch counter discards a refresh that started before a
  sign-out (no session resurrection); a tab adopts a refresh token another tab
  already rotated (reusing a rotated Supabase token revokes the whole family);
  cross-tab `storage` sync; refresh on resume/online.
- **Sign-out** revokes server-side (`POST /auth/logout`), withdraws web push,
  and on Android cancels every armed reminder, dismisses ours, unregisters the
  push token, and clears the WebView back stack.
- **Server refresh classification:** 401 only when Supabase rejects the token;
  503 when Supabase is unreachable.

### 4.2 Today and Calendar
- Week, day and month views; mobile agenda; deep links (`#calendar?event=…`)
  open a specific event from a notification.
- **Reminders:** every event reminds 1 h before and at the start, plus custom
  `event_reminders`; all-day events remind at the start only. Served by
  `/schedules/upcoming` and armed on the phone.
- **Completion:** "Mark done" only after the start, within a 12-hour window
  (all-day: the day); editing is rejected once started — enforced server-side,
  mirrored in `eventActionState`. A started or completed event opens as a
  read-only card (when/where/status) with Mark done · Delete · Close; the state
  re-evaluates every 30 s while open.

### 4.3 Library, reader and podcasts
- Books, podcasts (YouTube), articles, notes; collections; status/progress.
- **PDF pipeline** (`shared/src/pdf.ts`): pdfjs extracts positioned text →
  blocks (heading/subheading/paragraph/caption) → paragraphs, TOC from the
  outline, running heads stripped; scanned PDFs go through Tesseract on-device.
  The raw PDF never leaves the device; the structured JSON is cached in
  IndexedDB and uploaded once to Supabase Storage (signed URLs) so other
  devices never re-extract. Resolution order: device cache → cloud → extract.
- **Reader:** chapters, highlights in five colours, notes/quotes/summaries/
  questions, bookmarks, search, reading sessions.
- **Podcast player:** YouTube IFrame API, mini bar, speed, OS media session
  (lock-screen / headset controls).

### 4.4 Offline reading
- **Download for offline** (book row menu or book sheet): saves the complete
  structured text under the reader's own cache key, plus the book's notes and
  bookmarks; progress %, done/failed states, remove; duplicate downloads are a
  no-op; `navigator.storage.persist()` requested.
- **Opens with no network:** the service worker precaches every built asset
  (an asset manifest emitted at build time) and serves navigations
  network-first with the cached shell as fallback — on the web and inside the
  Android WebView. The library list is cached per user.
- **Sync:** see the outbox in [§9](#9-reliability-engineering).

### 4.5 Knowledge
- Every note, quote, highlight, summary, question and bookmark across the
  library, **grouped automatically by source** (`lib/knowledgeGroups.ts`):
  derived on the fly (nothing stored, nothing to migrate), merged across title
  formats ("Sapiens" = "Sapiens: A Brief History…" unless authors differ),
  book vs podcast kept apart, sourceless entries in "Unsorted".
- Group cards (cover, type, author, count, kind breakdown), search across
  titles and text, sort (recent / A–Z / size), type filter, group detail with
  in-place edit and delete.

### 4.6 Schedules — three modes
| Mode | Payload | At the time |
|---|---|---|
| **Remind me** | `notify` `{title, body}` | The phone's alarm fires the notification (armed up to 7 days ahead); the agent also records it in-app and pushes only to devices that did not arm it. |
| **AI message** | `chat_message` `{prompt}` | The agent runs the full agent core *as the user* (a short-lived session, revoked after), posts the reply to the chat, and notifies "Done". |
| **Email** | `email` `{to, prompt}` | The model writes `{subject, body}`; the core sends it from the connected Gmail. "Let me approve it first" parks it in the approvals queue instead. Offered only when a mailbox has send scope. |

Once / daily / weekly; edit, cancel/pause, delete; per-row status from the
latest run; run history with results. Execution semantics in
[§9](#9-reliability-engineering).

### 4.7 Notifications
- **Local clock (Android):** `expo-notifications` DATE triggers on two
  channels (`reminders`, `briefs`) at HIGH importance (heads-up),
  PRIVATE lock-screen visibility (the user's privacy setting decides), exact
  alarms (`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`), re-armed after reboot.
  The web app fetches the next week with its live session and hands the list
  to the phone (`arm` message) on sign-in, resume, and every schedule/calendar
  change; the native fetch is a fallback; passes are serialised.
- **In-app:** `notifications` rows over Supabase Realtime → toasts and a bell.
- **Web push:** VAPID, service worker, actions, deep links.
- **Android push:** Expo push (FCM, `priority: high`) — wired, but **off by
  choice** until Firebase is configured ([§13](#13-verification-status-and-known-limits)).
- **Settings → Notifications** (in the app) shows permission, how many
  reminders are armed, when the list last synced (or why it failed), a test
  notification, and permission recovery.

### 4.8 Mail (Gmail)
- **Setup in the app:** paste a Google OAuth client (ID + secret); the secret
  is AES-256-GCM encrypted and write-only. The redirect URI is derived by the
  server (`PUBLIC_API_URL` or Render's `RENDER_EXTERNAL_URL` +
  `/api/v1/gmail/callback`) and shown with a Copy button — never typed. Env
  vars (`GOOGLE_CLIENT_ID/SECRET`) are the alternative.
- **Connect:** per-mailbox read-only or read+send (`gmail.readonly` +
  `gmail.send`, never `modify`); HMAC-signed, time-boxed `state` carrying the
  return target; the Android app returns via `mypro://gmail`.
- **Sync:** backfill then incremental (Gmail history API); runs right after
  connecting, from Settings, and automatically before the assistant reads mail
  (throttled to once per 2 min per user).
- **Insights:** the agent summarises/categorises messages tool-free (injection
  hardened) into `email_insights`.
- **Send:** only from the core (it alone holds the token key); gated on the
  stored scope. RFC 2822 with RFC 2047-encoded subjects and a base64 body, so
  any language, emoji or long line arrives intact; Google's own error text is
  reported.
- **Approval:** an outward email appears as a card with the full message —
  edit To/Subject/Text, then Send or Discard. Approval is an atomic claim (a
  double tap sends once); a send that certainly failed returns to the queue
  with the reason and a "Try again"; a timeout (might have sent) is never
  resent; expired requests cannot be approved.
- **Approval in your own message:** "email x@y.com …, send it directly" (or
  "no need to ask me", "you have my approval") sends at once without the card —
  also when scheduling an email through the assistant, and for scheduled AI
  tasks whose instructions say so. Decided by deterministic code on the
  user's own words (`skills/consent.ts`), never by the model: the message must
  explicitly approve, must not say "don't send", and must name the exact
  recipient address, so text inside an email or web page can never grant it.
  A failed direct send falls back to the approval card with the reason.
- **Test sending:** Settings → Mail → *Send test email* sends a real email now
  through the same path (no approval step) and shows the Gmail message id or
  the exact error.
- `/gmail/status` reports exactly what a deployment is missing.

### 4.9 Other domains
- **Health records** — symptoms, medications, documents; the assistant can
  read them only under a time-boxed grant (see [§8](#8-security-model)).
- **Commitments** — open loops with deadlines, states (open / at_risk / done /
  slipped / abandoned) and check-ins the Pulse follows up on.
- **Tasks**, **interests** (followed teams/companies/topics watched for news),
  **Strava** training history (read through the core).
- **Settings** — profile, Colour Mode, notifications, mail, storage, privacy.

---

## 5. The AI companion

### 5.1 Request path
```
POST /assistant/messages
  → settings → effort budget → memory load (facts, narrative, episodes, threads)
  → intent routing     keyword scoring + one small model call → candidate capabilities
  → planning           independent sub-tasks become plan steps (persisted)
  → execution          tool loop, parallel reads, budgeted steps, honest exhaustion
  → verification       reconcile plan steps against tool receipts
  → one answer         written against that verdict; display blocks for the UI
```
Each stage degrades into the one below; a short Light-mode question is one
model call.

### 5.2 Effort modes (`agent/effort.ts`)
| | Light | Normal | Deep |
|---|---|---|---|
| tool steps | 3 | 6 | 12 |
| capabilities offered | 6 | 14 | 32 |
| plan / verify | — | ✓ | ✓ |
| semantic facts / episodes / threads | 6 / 0 / 2 | 20 / 3 / 5 | 40 / 6 / 8 |
| max output tokens | 1 024 | 4 096 | 8 192 |
| search results / pages fetched | 3 / 0 | 5 / 2 | 8 / 5 |

### 5.3 Skills (37)
| Area | Skills |
|---|---|
| Calendar | `list_events` `create_event` `update_event` `delete_event` |
| Tasks | `list_tasks` `create_task` `update_task` |
| Commitments | `list_commitments` `create_commitment` `update_commitment` |
| Memory | `remember` `forget` `open_thread` `close_thread` |
| Library & knowledge | `search_library` `add_library_item` `update_reading_progress` `search_knowledge` `save_note` |
| Health | `list_health_records` (grant-gated) |
| Notifications & schedules | `send_notification` `list_schedules` `create_schedule` `delete_schedule` |
| Mail | `list_emails` `search_emails` `send_email` (**outward → approval**) |
| Internet | `web_search` `news_search` `fetch_page` `get_weather` |
| Fitness & interests | `list_activities` `follow_interest` `list_interests` `update_interest` |

Side effects are typed `read` / `write` / `outward`. `outward` never runs from
the model: the executor parks it in `pending_actions` for explicit approval.
Every invocation is a receipt (`skill_invocations` + `role='tool'` rows).

### 5.4 Models (`llm/llm.service.ts`)
Provider chosen by model-name prefix (`gemini:…`, `cohere:…`, `sambanova:…`,
none = Groq); `LLM_FALLBACK_MODEL` is an ordered chain. Groq is fast with a
small free token budget, Gemini slow with a large one — they fail in opposite
directions, which is why both exist. Gemini's `thoughtSignature` is preserved
by replaying model turns verbatim.

### 5.5 Memory
Semantic facts with decay (`memory/decay.ts`, pure), a weekly narrative
snapshot, episodic summaries every 6 h, and live attention threads — all
budgeted per effort mode and injected into the system prompt.

### 5.6 Research (`research/`)
12 providers behind per-kind chains (search: Tavily, Brave, SearXNG, native;
news: NewsData, Guardian, GDELT, RSS; sports: TheSportsDB; extract: Firecrawl,
native; weather: Open-Meteo; Wikipedia). SSRF guard (private ranges, redirects
re-checked), robots.txt, per-host delay, byte/char caps, result cache, usage
ledger. All web text is marked untrusted.

### 5.7 The Pulse (proactivity)
Every 30 min: candidate signals (commitment due, task due, email needing
action, silence, evening close-out, weekly review, interest news) scored as
`urgency × value × novelty`, gated by minimum score, per-type cooldown and a
daily budget of 3, composed tool-free, and **every** candidate — sent or
suppressed — recorded in `interventions` with the reason.

### 5.8 Chat UI
Safe Markdown rendering (headings, nested/task lists, tables, quotes, code
with Copy; React elements only, http/mailto links only); replies as clean
full-width text, your turns as bubbles; stick-to-bottom scrolling with a
"Latest" jump; auto-growing composer; typing indicator; plan and result cards;
approvals queue; Light/Normal/Deep per message.

---

## 6. Data model

4NF throughout: multivalued facts get their own tables (no arrays, no
type-discriminated blobs); subtype detail tables keep `library_items` lean.

| Domain | Tables |
|---|---|
| Identity | `profiles` `user_phone_numbers` `user_activity` `audit_log` |
| Library & reading | `library_items` `book_details` `podcast_details` `article_details` `note_details` `collections` `collection_items` `annotations` `annotation_tags` `tags` `bookmarks` `reading_sessions` `listening_sessions` `item_sources` |
| Calendar & tasks | `calendar_events` `event_categories` `event_reminders` `tasks` `task_tags` |
| Mail | `gmail_accounts` `email_messages` `email_labels` `email_message_labels` `email_attachments` `email_insights` `google_oauth_config` |
| Health | `health_records` `health_symptoms` `health_medications` `health_documents` `health_access_grants` |
| Assistant | `assistant_persona` `assistant_settings` `assistant_conversations` `assistant_messages` `assistant_memory` `narrative_snapshots` `memory_episodes` `attention_threads` `interventions` `commitments` `agent_plans` `agent_plan_steps` `skill_invocations` `pending_actions` |
| Schedules & delivery | `assistant_schedules` `assistant_schedule_days` `schedule_runs` `system_jobs` `notifications` `notification_channels` `device_tokens` |
| Research & integrations | `research_cache` `research_usage` `interests` `interest_findings` `strava_accounts` |
| Operations | `node_status` `service_pings` |

**Migrations** (apply in order in the Supabase SQL editor; all re-runnable):

| # | Adds |
|---|---|
| 0001–0002 | schema; RLS default-deny owner-only on every table |
| 0003 | `node_status` (presence/discovery), deferred schedule runs |
| 0004 | skill receipts and pending actions |
| 0005 | storage for extracted PDF text |
| 0006 | Realtime on `notifications` |
| 0007–0008 | `deferred` run status; outward-action results |
| 0009–0011 | commitments, narrative memory, companion layers (episodes, threads, interventions) |
| 0012 | agent plans and steps |
| 0013–0014 | research cache/usage; Strava, interests |
| 0015–0016, 0018 | `pg_cron` keep-alive for core and agent (agent address discovered) |
| 0017 | renderable blocks on assistant messages |
| 0019 | daily retention (`prune_old_history`) — history only, never content |
| 0020 | event completion |
| 0021 | in-app Google OAuth app credentials (secret encrypted, RLS with no policies) |
| 0022 | scheduler: run `attempt`/`result`, `retrying` status, `device_tokens.armed_at` |
| 0023 | `position_updated_at` on book/podcast details (offline conflict resolution) |

---

## 7. API surface

All routes under `/api/v1`. Core (`backend-render`):

```
auth/signup|login|refresh|logout      POST   brokered auth; refresh 401 = dead, 503 = unreachable
me  me/activity  me/realtime  me/push GET/PATCH/POST
library                               CRUD; PATCH accepts position_at (newest position wins)
  /:id/annotations|bookmarks|reading-sessions|listening-sessions   client-uuid idempotent creates
  /:id/pdf-text/upload-url|url|confirm                             signed URLs
collections  knowledge  tasks  commitments  interests
calendar/events|categories            CRUD; /events/:id/complete POST/DELETE (window enforced)
health/records  health/grant          grant-gated
notifications  devices(/unregister, /channels)
schedules                             CRUD; /upcoming?hours≤168 (the clock); /:id/runs
gmail/status|accounts|messages|connect|callback|oauth-config|sync|accounts/:id
strava/*  nodes/status  healthz
internal/gmail/send|sync  internal/strava/*  internal/keepalive     shared secret only
```

Agent (`backend-local`):
```
assistant/conversation|messages|settings|persona|capabilities|plans|clear
skills  skills/invocations|pending  skills/pending/:id/approve|reject
internal/ai/complete                  shared secret only
```

---

## 8. Security model

- **Secrets by deployable.** Core: Supabase secret key, `TOKEN_ENCRYPTION_KEY`,
  OAuth client secrets. Agent: model and research keys, Supabase secret key —
  **never** an OAuth token or the encryption key; it asks the core to send
  mail. A compromised agent cannot read the mailbox.
- **Two DB clients**, deliberately separate: `forUser(jwt)` (RLS applies; every
  user-facing path and every skill) and `admin` (bypasses RLS; background work
  only, always filtered by `user_id`).
- **RLS** `enable` + `force`, default-deny, owner-only; the OAuth-config table
  has no client policies at all.
- **Health** behind a time-boxed grant, checked three times: tool absent
  without it, re-checked at call time, read through a `SECURITY DEFINER`
  function that re-checks in SQL and audits.
- **Outward actions** require explicit approval; the core re-validates parked
  arguments and marks approval before sending.
- **Prompt injection** assumed: email and web text reach the model only as
  marked data; background generations over third-party text run tool-free;
  web fetches are SSRF-guarded.
- **OAuth** `state` is HMAC-signed with a 10-minute TTL and carries the return
  target inside the signature; tokens AES-256-GCM at rest.
- **Scheduled AI runs as the user:** a magic-link session minted server-side
  (no email sent) so RLS still applies, revoked when the run ends.
- **Device hygiene:** a push token belongs to one account at a time; sign-out
  withdraws push and cancels armed reminders.

---

## 9. Reliability engineering

| Problem | Mechanism |
|---|---|
| Session dies mid-use | Central 401 → single refresh → retry; single expiry event; no further network calls |
| Scheduler double-execution | **Claim before execute**: conditional update on `next_run_at`; only the winner runs (at-most-once) |
| Transient failures | Retry at 2 / 10 / 30 min, only when nothing outward happened; never past the next occurrence |
| Duplicate email | A send timeout (might have sent) is never retried; an edge 404 (never reached) is |
| Wrong service address | Core announces its API root; agent discovers it, re-reads after a 404, env only as fallback |
| Offline writes | **Outbox** (`lib/outbox.ts`): durable per-user queue; patches coalesce per item; create→delete cancels; FIFO drain; removed only on success; triggers on online/resume/visibility/pagehide and Android resume |
| Retried creates | Client-generated UUIDs; `insertOnce` returns the existing row on `23505`; bookmarks upsert per page |
| Cross-device conflicts | `position_at` recorded on the device; the core ignores positions older than `position_updated_at` |
| Reminder delivery | Armed on the phone up to 7 days ahead; re-armed on change/resume/background; local/push dedupe via `armed_at` |
| Render sleeping | `pg_cron` keep-alive; reader opens from cache after 4 s when a copy exists |
| Stale bundles offline | Network-first navigations; content-hashed assets cache-first; old assets trimmed |
| CI flakiness | Gradle dependency cache; rate-limit/timeout retry; builds only on `main` |
| Data growth | Daily retention prunes history tables only |

---

## 10. Configuration

Every deployable validates its environment with zod at boot and refuses to
start on anything invalid; blank values count as absent. `.env.example` files
hold placeholders only.

**Core (`backend-render`)** — `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `INTERNAL_SERVICE_TOKEN` (≥32), `TOKEN_ENCRYPTION_KEY`
(≥32), `CORS_ORIGINS`, `APP_URL`; optional `GOOGLE_CLIENT_ID/SECRET`,
`GOOGLE_REDIRECT_URI` (override), `PUBLIC_API_URL`, `STRAVA_*`,
`WEB_PUSH_*`, `TELEGRAM_BOT_TOKEN`, `LOCAL_AGENT_URL`, `RATE_LIMIT_*`.
`RENDER_EXTERNAL_URL` is set by Render.

**Agent (`backend-local`)** — `SUPABASE_*`, `INTERNAL_SERVICE_TOKEN`,
`GROQ_API_KEY`, `PUBLIC_BASE_URL`, `SCHEDULER_ENABLED`; optional
`GEMINI/COHERE/SAMBANOVA_API_KEY`, `ASSISTANT_MODEL`, `ASSISTANT_ROUTER_MODEL`,
`ASSISTANT_PLANNER_MODEL`, `LLM_FALLBACK_MODEL`, `LLM_REQUEST_TIMEOUT_MS`,
`RENDER_API_URL` (fallback only), `SCHEDULER_STALE_MINUTES`, `WEB_PUSH_*`,
research keys (`TAVILY`, `BRAVE_SEARCH`, `SEARXNG_BASE_URL`, `NEWSDATA`,
`GUARDIAN`, `THESPORTSDB`, `FIRECRAWL`, `NEWS_RSS_FEEDS`) and
`RESEARCH_*` chain/limit settings.

**Web (`frontend`)** — `VITE_API_URL`; optional `VITE_AGENT_URL`,
`VITE_OCR_*`.

**Android build (GitHub secrets)** — `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_WEB_URL`; optional `EXPO_PUBLIC_AGENT_URL`,
`EXPO_PUBLIC_SHELL`, `EAS_PROJECT_ID` + `GOOGLE_SERVICES_JSON` (push).

---

## 11. Development, build, deploy

```bash
pnpm install                     # workspace: frontend, shared, android
```
```bash
pnpm --dir frontend dev          # web on $PORT (default 8443)
```
```bash
cd backend-render && npm install && npm run dev
```
```bash
cd backend-local && npm install && npm run dev
```
```bash
start-agent.bat                  # agent on a laptop with a Cloudflare quick tunnel
```

Type checks: `npx tsc --noEmit` in `frontend/`, `android/`, `backend-render/`,
`backend-local/`. Production web build: `pnpm --dir frontend build`.

**Deploy:** push to `main`. Vercel builds the web; Render redeploys
`mypro-core` and `mypro-agent` (blueprint in `render.yaml`); GitHub Actions
builds the release APK (artifact `mypro-apk`). **Migrations are never applied
by a push** — run each new SQL file in the Supabase SQL editor.

---

## 12. Testing

| Package | Files | Tests | Covers |
|---|---|---|---|
| `shared` | 4 | 38 | session expiry and refresh races, 401 recovery, PDF block grouping, notification mapping |
| `frontend` | 5 | 51 | scheduler form ↔ API mapping, Markdown parser (incl. unsafe links), knowledge grouping, outbox (coalescing, ordering, interrupted sync, drop/retry), calendar event states and time zones |
| `backend-render` | 9 | 75 | Email send end to end (real send path, decoded MIME, encoded subjects, Google errors), Gmail scopes and credential resolution, redirect derivation, OAuth state signing, refresh classification, schedule validation, calendar reminders/completion, recurrence, conflict resolution, idempotent inserts, self-address announcement |
| `backend-local` | 32 | 385 | send consent from the user's own message, direct sends and email scheduling, email approval (claim, edits, retry, ambiguous timeouts, expiry), agent→core mail hop, capability routing and evaluation, planning/effort, verification, skill execution, scheduler (claim, three modes, retries, email gating), push dedupe, research (normalisation, robots, SSRF, failure chains), Pulse scoring, memory decay, Core-address discovery |
| **Total** | **50** | **549** | |

Run: `pnpm --dir shared test`, `pnpm --dir frontend test`, `npm test` in each
backend. Browser verification (Playwright, phone widths against a mock API)
covered: login → session expiry mid-use → redirect with message → no stray
requests → re-login restores the view; all three scheduler modes; knowledge
groups; Markdown chat; read-only started events; Gmail setup; download →
offline restart → read → offline edits survive restart → sync on reconnect →
stale offline write rejected.

---

## 13. Verification status and known limits

**Verified by automation:** everything in §12.

**Not verifiable from CI — confirm on a device / live services:**
- Reminder delivery on physical Android (heads-up, lock screen, Doze, OEM
  battery managers). Settings → Notifications shows armed count and last sync
  result to make this diagnosable.
- Real Google OAuth consent and Gmail send/sync against live Render.
- The scheduled-AI session broker (magic-link mint) against the live Supabase
  project; on failure it falls back to a tool-free answer and says so.
- Offline reading inside the Android WebView (standard Chromium IndexedDB and
  service worker, untested on hardware).

**Known limits (by design or pending configuration):**
- **No Android push** until Firebase is configured (`EAS_PROJECT_ID`,
  `GOOGLE_SERVICES_JSON`). Reminders still fire from the local clock;
  "AI task done" / "email sent" alerts appear in-app on next open.
- **Gmail in Google "Testing" mode** expires the connection every 7 days and
  admits only listed test users; removing that requires Google verification.
- **Sync runs while the app is open/resuming/reconnecting**, not with the app
  fully closed (that needs native WorkManager).
- **Offline covers reading**; calendar, chat, brief and knowledge need a
  connection. Scanned PDFs without a text layer cannot be downloaded.
- **Cloud storage of PDF files does not exist**; only extracted text syncs.
- Migrations **0019–0023** must be applied by hand where not already.

---

## 14. Documentation index

| Document | Contents |
|---|---|
| `AGENTS.md` | How to work in this repo (commands, conventions, rules) |
| `docs/PHASES.md` | Every phase, goal and status — the plan |
| `docs/BACKEND_PLAN.md` | The architecture contract: schema, RLS, endpoints |
| `docs/AI_SYSTEM.md` | The assistant as built: models, memory, skills, Pulse, security |
| `docs/AGENT_SPEC.md` | Agent core: routing, planning, execution, verification, effort |
| `docs/RESEARCH_PROVIDERS.md` | Web/news/sports/weather providers and chains |
| `docs/ZERO_COST_PLAN.md` | Hosting on free tiers; why the phone is the clock |
| `docs/DEPLOY_AGENT_TO_RENDER.md` | Running the agent on Render instead of a laptop |
| `docs/ANDROID_UPGRADE.md` | The WebView shell cutover |
| `docs/COMPANION_VISION.md` | Where the companion is heading |
| `docs/HANDOFF.md` | What the most recent sessions changed |
