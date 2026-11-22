# MyPro — Backend & Data Architecture Plan

A single intelligent personal space: **Calendar · Library/Reader · Knowledge · Health · AI Assistant**, across **web (now)** and **mobile app (later)**, sharing one backend and one database. The assistant behaves like a friend — it chats, remembers, schedules, and reaches out proactively (morning brief, nudges when you go quiet).

> **Status.** Three deployables plus the phone (the Oracle VM design was
> dropped). `docs/ZERO_COST_PLAN.md` supersedes the hosting assumptions below;
> `docs/PHASES.md` says what is built.
>
> - `frontend/` — the web app (Vercel). Thin client: it configures **one** URL
>   (render) and discovers the laptop through it.
> - `android/` — Expo app, importing `shared/`. **It is the clock** (Phase 11):
>   it arms local notifications for the next 48h, so a brief arrives on time
>   with the laptop shut and render asleep.
> - `backend-render/` — the request-driven core: all CRUD, auth brokering,
>   signed URLs, schedules, Gmail. **May sleep.** Its in-process scheduler was
>   retired in Phase 11 and is inert unless `SCHEDULER_ENABLED=true`.
> - `backend-local/` — the personal agent on the laptop: assistant chat + LLM,
>   direct Supabase access, 30s heartbeat, `/internal/ai/complete` for render,
>   **the drain loop**, the notification fan-out, and email summaries.
> - `shared/` (`@mypro/shared`) — types, API client, auth, agent discovery, PDF
>   text core, Realtime. Imported by web and Android, so there is never a
>   second implementation. The backends are *not* workspace members.
> - `supabase/migrations/` — 0001 schema (4NF) · 0002 RLS + health gate ·
>   0003 node presence · 0004 skills · 0005 pdf-text storage · 0006 realtime ·
>   0007 deferred run status · 0008 pending-action result · 0009 commitments ·
>   0010 narrative memory · 0011 companion layers · **0012 agent core**
>
> Staying awake: Supabase Cron + pg_net POST render's `/internal/keepalive`
> every 10 minutes (`0015_keepalive.sql`), which is what keeps the free
> instance resident. It is a ping, not a scheduler tick — `SCHEDULER_ENABLED`
> stays false on render, and the clock remains on the laptop.
>
> Offline story: laptop closes → heartbeat stale in ~90s → UI greys the
> assistant. Scheduled work simply waits for the laptop and is skipped if it
> went stale; the phone's own alarm still fires, and the app composes the plain
> brief itself.
>
> Decisions taken: NestJS · Supabase Auth brokered by render · **Telegram
> dropped** (the in-app chat is the channel) · Expo · raw PDFs stay local,
> JSON + annotations sync · scanned PDFs read on-device with Tesseract.

---

## 1. Guiding principles

1. **One backend, many clients.** Web and the future app talk to the *same* API. No business logic duplicated per client.
2. **Supabase is the system of record.** Postgres + Auth + Storage + Row Level Security (RLS). The VM never holds durable state it can't lose.
3. **Local-first for heavy/private bytes.** PDFs are parsed on-device to JSON; the *structured JSON + annotations* sync, the raw PDF stays local unless the user opts into cloud sync.
4. **Health is walled off.** The assistant can touch everything *except* health, which requires an explicit, expiring permission grant. Enforced in the database (RLS) *and* the API layer, not just the UI.
5. **Outward actions are confirmed.** Sending mail, posting, moving data, deleting — the assistant proposes, the user approves. External content (emails, web) is untrusted input, never instructions.
6. **4NF schema.** No repeating groups, no multivalued facts crammed into one row, no nullable "type-specific" column soup. Subtype tables + junction tables.

---

## 2. Topology (deployment)

```
                               everything except /assistant/*
   Web (Vercel) ───────────────────────────────┐
   Android app (Expo) ─────────────────────────┤
     ▲  │                                      ▼
     │  │ /assistant/*              ┌───────────────────┐        ┌──────────────┐
  the│  ▼                           │  backend-render    │───────▶│   Supabase   │
 clock┌──────────────────┐ /internal/│  REQUEST-DRIVEN    │        │  Postgres +  │
   │  │  backend-local    │◀─────────│  CRUD · auth ·     │        │  Auth +      │
   │  │  laptop agent     │ ai/      │  signed URLs ·     │        │  Storage +   │
   │  │  assistant + LLM  │ complete │  schedules · gmail │        │  Realtime    │
   │  │  THE WORKER       │─────────▶│  MAY SLEEP         │        └──────────────┘
   │  └────────┬─────────┘ heartbeat └───────────────────┘
   │           │            (via node_status table)        ▲
   └───────────┘                        internal/gmail/send│
      local notifications,              (the laptop never holds
      armed 48h ahead                    a Gmail token)
            Groq (the only machine with the model key)
```

Three things are already always on and already free: **the phone's OS**, **the
laptop while it is open**, and **Postgres**. Each has the job it is good at —
the phone fires on time, the laptop does the work, Postgres holds the truth.
Render became what a free instance honestly can be: an API that is allowed to
sleep. `docs/ZERO_COST_PLAN.md` argues this out in full.

| Layer | Choice | Notes |
|---|---|---|
| Web host | **Vercel** | Static SPA (`frontend/`). **One** configured URL (`VITE_API_URL` → render); the laptop is discovered through it. `VITE_AGENT_URL` is an override for a fixed tunnel. |
| Mobile | **Expo / React Native** | `android/`, importing `shared/`. **The clock** (Phase 11): arms local notifications for the next 48h and re-arms on every launch, so the brief fires with the laptop shut. Push goes through Expo's gateway, which needs no server key. |
| Core API | **`backend-render/`** on **Render** | NestJS. All CRUD, auth brokering, signed URLs, schedules, Gmail. `render.yaml` blueprint at repo root. **The free tier sleeps, and that is now fine:** Phase 11 moved the clock off it, so nothing here needs to stay awake. A pinger was rejected deliberately — `docs/ZERO_COST_PLAN.md` §1. |
| Personal agent | **`backend-local/`** on **your laptop** | NestJS. `/assistant/*`, `/internal/ai/complete`, **the drain loop**, the notification fan-out and email summaries. Only holder of the model key. Heartbeats every 30s into `node_status`. |
| Laptop reachability | **Cloudflare Tunnel** (free) | HTTPS pages cannot call `http://<lan-ip>` (mixed content) and the laptop sits behind NAT — the tunnel gives it an HTTPS hostname. A *quick* tunnel's host changes on every start, which is why it is published into `node_status` rather than configured. |
| Offline story | heartbeat stale >90s | UI greys the assistant (`GET /nodes/status` on render); scheduler defers AI jobs 10 min × 3, then sends a plain non-AI message. |
| DB / Auth / Storage / Realtime | **Supabase** (managed) | Postgres 15, RLS, Supabase Auth (JWT), Storage; clients subscribe to `notifications` via Realtime so messages land instantly whichever node wrote them. |
| AI | **Groq** | Only on the laptop. Model from `ASSISTANT_MODEL` / per-user settings — never hardcoded, because availability shifts (`llama-3.3-70b-versatile` vanished once). The free tier is rate-limited, so every generation has a degrade path. |
| CI/CD | GitHub → Vercel (frontend) · GitHub → Render blueprint (core) | The laptop pulls + `npm run build` manually or via a small script. |

**Why this split:** render is the half that is always *reachable*, so data and
auth never depend on the laptop; the laptop is the private, powerful half that
holds the model key and the agent personality; and the phone is the half that
is awake at 08:30 for nothing. The system degrades — never breaks — when any
of them sleeps.

An earlier version of this line called render "the cheap always-on half, so
reminders and nudges never depend on the laptop". That turned out to be false:
the free instance sleeps after ~15 minutes of inactivity, so the reminders were
the one thing that *silently did not happen*. Phase 11 is the correction, and
the reason the clock now lives on the devices.

---

## 3. Security & privacy model

- **Auth:** Supabase Auth issues JWTs. The API verifies the JWT on every request and sets the Postgres `auth.uid()` context so **RLS** does the row filtering. Clients use the **anon** key only; the **service-role** key lives *only* on the VM.
- **RLS everywhere:** every user-owned table has `user_id uuid` and a policy `user_id = auth.uid()`. Default deny.
- **Health gate (two layers):**
  1. **DB:** `health_*` tables' RLS additionally requires a live row in `health_access_grants` (scoped to the requesting agent + not expired) when the caller is the assistant service role.
  2. **API:** the assistant's data-access service literally cannot build a health query without an active grant token; health tools are excluded from the tool list until the user approves (grant has `expires_at`).
- **Gmail tokens** encrypted at rest (pgcrypto or app-level AES via a VM-held key), never returned to clients.
- **Secrets:** `.env` on the VM + Vercel/Supabase dashboards. No secrets in the repo or client bundle.
- **Untrusted input:** email bodies, article text, and PDF text are *data* to the AI, never commands. Outward/irreversible actions need explicit user confirmation.
- **Backups:** Supabase PITR; periodic `pg_dump` to Storage.

---

## 4. Database schema (4NF)

Convention: all tables `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at`. `user_id uuid references auth.users` on every user-owned table (RLS key). FKs `on delete cascade` unless noted. Enums are Postgres `enum` or small lookup tables.

### 4.1 Identity & profile

```sql
-- Supabase owns auth.users (email/login). We extend it:
profiles(
  user_id uuid pk references auth.users on delete cascade,
  display_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  locale text default 'en',
  color_mode boolean default false      -- MyPro mono/color
)

-- Multivalued contact facts live in their own tables (4NF), not columns:
user_phone_numbers(id, user_id, phone text, label text, is_primary bool)
```

### 4.2 Presence (for "message me when I'm inactive")

```sql
user_activity(
  user_id uuid pk references profiles,
  last_active_at timestamptz,          -- updated on any client heartbeat
  last_seen_client text,               -- 'web' | 'app'
  inactive_notified_at timestamptz     -- so we nudge once, not in a loop
)
```

### 4.3 Gmail (multiple accounts + processing)

```sql
gmail_accounts(
  id, user_id,
  email text not null,
  google_sub text,                     -- stable Google account id
  access_token_enc bytea,
  refresh_token_enc bytea,
  token_expires_at timestamptz,
  scopes text,
  history_id text,                     -- for incremental sync
  watch_expiration timestamptz,
  sync_state text,                     -- 'idle'|'syncing'|'error'
  unique(user_id, email)
)

email_messages(
  id, gmail_account_id references gmail_accounts, user_id,
  gmail_message_id text, gmail_thread_id text,
  from_addr text, to_addrs text, subject text,
  snippet text, internal_date timestamptz,
  is_read bool, is_important bool,
  unique(gmail_account_id, gmail_message_id)
)

email_labels(id, gmail_account_id, gmail_label_id text, name text)
-- M:N message↔label (resolves a repeating group → 4NF)
email_message_labels(email_message_id, email_label_id, primary key(...))

email_attachments(id, email_message_id, filename, mime_type, size_bytes, gmail_attachment_id)

-- AI/processing output kept separate from raw mail:
email_insights(
  id, email_message_id unique, user_id,
  summary text, category text,          -- 'action'|'fyi'|'promo'|...
  action_needed bool, due_hint timestamptz,
  generated_by text, generated_at timestamptz
)
```

Email → task/event creation is **not** a column on the email; it's a normal `task`/`calendar_event` row with a provenance link (§4.9) so the same mechanism works for any source.

### 4.4 Calendar

```sql
event_categories(id, user_id, name, tone)         -- Work/Personal/Health/Reading...
calendar_events(
  id, user_id, title, description,
  starts_at timestamptz, ends_at timestamptz, all_day bool,
  location text, category_id references event_categories
)
event_reminders(id, calendar_event_id, minutes_before int, channel text)  -- 1:M, not an array
```

### 4.5 Tasks

```sql
tasks(id, user_id, title, notes, due_at timestamptz, status text, priority int)
tags(id, user_id, name, unique(user_id, name))     -- shared tag vocabulary
task_tags(task_id, tag_id, primary key(task_id, tag_id))   -- M:N → 4NF
```

### 4.6 Library (polymorphic done right — base + subtype 1:1)

Avoids one wide table full of nulls. The base row is the identity; each type has its own table.

```sql
library_items(
  id, user_id,
  type text not null,                   -- 'book'|'podcast'|'article'|'note'
  title text, creator text,
  status text,                          -- in_progress|completed|want|favorite
  progress int,                          -- 0..100
  cover_url text, tone text,
  accessed_at timestamptz
)

book_details(
  library_item_id pk references library_items on delete cascade,
  total_pages int, current_page int,
  is_physical bool,
  pdf_filename text, pdf_storage text,  -- 'device'|'sync'
  pdf_json_path text,                   -- Supabase Storage path to extracted JSON
  sync_status text, file_size_bytes bigint, last_synced_at timestamptz
)

podcast_details(
  library_item_id pk references library_items on delete cascade,
  youtube_url text, channel text, episode_title text,
  duration_seconds int, current_time_seconds int, playback_speed numeric
)

article_details(
  library_item_id pk references library_items on delete cascade,
  source_url text, author text, read_time_minutes int, content_ref text
)

note_details(
  library_item_id pk references library_items on delete cascade,
  body text
)
```

### 4.7 Collections (M:N)

```sql
collections(id, user_id, name, sort_order int)
collection_items(collection_id, library_item_id, primary key(collection_id, library_item_id))
```

### 4.8 Reader: annotations, markers, sessions

```sql
annotations(
  id, user_id, library_item_id references library_items,
  kind text not null,                   -- note|quote|summary|question|highlight
  page int, paragraph int,              -- logical anchor (survives font/zoom/mode)
  anchor_text text,                     -- the original passage
  title text, body text, color text,
  chapter text
)
annotation_tags(annotation_id, tag_id, primary key(annotation_id, tag_id))   -- M:N

bookmarks(id, user_id, library_item_id, page int, title text)

reading_sessions(
  id, user_id, library_item_id,
  started_at timestamptz, ended_at timestamptz,
  start_page int, end_page int, notes text
)
listening_sessions(
  id, user_id, library_item_id,
  started_at, ended_at, start_seconds int, end_seconds int
)
```

**My Knowledge** is a *view/query* over `annotations` (+ bookmarks), not a duplicated table — single source of truth.

### 4.9 Provenance (one link type for "X created this")

```sql
item_sources(
  id, user_id,
  target_type text, target_id uuid,     -- e.g. ('task', <uuid>)
  source_type text, source_id uuid,     -- e.g. ('email_message', <uuid>) or ('assistant_message', ...)
  created_at
)
```

### 4.10 Health (gated — separate, minimal, auditable)

```sql
health_records(id, user_id, name, status, severity,
               started_on date, ended_on date, diagnosis text,
               doctor text, consultation_on date, notes text)
health_symptoms(id, health_record_id, name, started_on date, severity text, notes text)   -- 1:M
health_medications(id, health_record_id, name, dosage text, frequency text,
                   started_on date, ended_on date, reason text, observations text)         -- 1:M
health_documents(id, health_record_id, filename, kind text, storage_path text)             -- 1:M

health_access_grants(
  id, user_id,
  grantee text not null,                -- 'assistant'
  scope text not null,                  -- 'read'|'read_write'
  granted_at timestamptz, expires_at timestamptz not null
)
```

### 4.11 Assistant (the friend)

```sql
assistant_persona(
  user_id pk references profiles,
  name text default 'MyPro',
  tone text,                            -- 'warm, casual, like a close friend'
  style_notes text,                     -- the "charter": how it talks, boundaries
  check_in_time time,                   -- morning-brief local time
  inactivity_hours int default 10,      -- nudge threshold
  proactive_enabled bool default true
)

assistant_conversations(id, user_id, title, last_message_at timestamptz)
assistant_messages(
  id, conversation_id references assistant_conversations, user_id,
  role text,                            -- 'user'|'assistant'|'tool'
  content text,
  tool_name text, tool_payload jsonb,   -- when the assistant used a capability
  created_at
)

assistant_memory(                       -- long-term facts it should remember
  id, user_id, key text, value text, source text,
  confidence numeric, last_used_at timestamptz,
  unique(user_id, key)
)
```

### 4.12 Scheduling, notifications, devices

```sql
scheduled_jobs(
  id, user_id,
  kind text,                            -- 'reminder'|'morning_brief'|'inactivity'|'gmail_sync'|'custom'
  cron text,                            -- or run_at for one-shot
  run_at timestamptz,
  payload jsonb,
  enabled bool default true,
  next_run_at timestamptz
)
job_runs(id, scheduled_job_id, ran_at, status text, detail text)   -- audit/history

notification_channels(                  -- which ways we can reach the user (M:N-ish per user)
  id, user_id, type text,               -- 'web_push'|'fcm'|'telegram'|'email'
  enabled bool
)
device_tokens(
  id, user_id, channel_type text,       -- 'web_push'|'fcm'
  token text,                           -- web-push subscription JSON or FCM token
  telegram_chat_id text,
  platform text, last_seen_at timestamptz,
  unique(user_id, token)
)
notifications(
  id, user_id, title, body, deeplink text,
  kind text, read_at timestamptz, delivered_at timestamptz, created_at
)
```

**Run history:** `schedule_runs.status` is
`success | failed | skipped | pending_confirmation | deferred`. `deferred` was
added in `0007_schedule_run_deferred.sql` — the scheduler had always written it
when a job waited for the sleeping laptop, but the original constraint rejected
it and the error was discarded, so those runs were never recorded.

**4NF notes:** multivalued facts (a message's labels, an event's reminders, a record's medications/symptoms/documents, a task's tags, a user's phones) each live in their own table — no arrays, no repeating columns, no type-discriminated nullable blobs. Subtype tables keep `library_items` lean. Junctions (`*_tags`, `collection_items`, `email_message_labels`) carry only the relationship.

---

## 5. PDF → JSON (local-first, web + app) — **implemented**

The extracting device is whichever one holds the file; every other device reads
the JSON it produced. The raw PDF never travels.

1. User selects a PDF → **parsed on-device** with `pdfjs-dist` (web). The real
   page count comes from the file itself at import time.
2. Text is extracted per page and shaped into reading paragraphs by
   `shared/src/pdf.ts` (`groupParagraphs`): lines from the engine's EOL flags,
   paragraph breaks from leading, indent and stub lines, line-end hyphens
   stitched, page numbers dropped. The PDF outline becomes the reader's TOC.
   Extraction is lazy — the open page first, the rest in background chunks.
3. Raw PDF stays **local** (IndexedDB `mypro_storage_vault` on web). The
   extracted JSON (`PdfTextDoc`) is cached beside it (store `pdf_text`), and on
   Android in `FileSystem.documentDirectory/pdf-text/`.
4. Once complete, the JSON goes to the private `pdf-text` Storage bucket as
   `<user_id>/<library_item_id>.json` and `book_details.pdf_json_path` records
   it. Clients hold no Supabase key, so **backend-render brokers signed URLs**
   (`backend-render/src/library/pdf-text.module.ts`); the client streams the
   JSON straight to Storage, keeping multi-megabyte bodies off Render, whose
   JSON body limit is 1 MB:

   | Method | Path | Purpose |
   |---|---|---|
   | `POST` | `/library/:itemId/pdf-text/upload-url` | one-shot signed PUT URL (+ object path) |
   | `GET`  | `/library/:itemId/pdf-text/url` | short-lived signed GET URL, or `null` when nothing is stored |
   | `POST` | `/library/:itemId/pdf-text/confirm` | record `pdf_json_path` + page count after upload |

   Bucket and owner-folder storage policies: `supabase/migrations/0005_pdf_text_storage.sql`.
5. A PDF with **no text layer at all** is read on the device with text
   recognition (Phase 10.4): pdfjs rasterises each page and Tesseract
   (WebAssembly, in a worker) reads it, front to back, saving every four pages
   so a closed tab resumes rather than restarting. Recognised pages carry
   `ocr: true`, since there are no font metrics behind them — every line
   arrives as a paragraph and nothing downstream should mistake machine-read
   text for the real thing. On-device for the same reason as the rest of this
   pipeline: sending page images to a cloud OCR service would break the
   promise for exactly the most private documents. Android has no renderer, so
   a scan there still reports `scanned` and says to open it once on the web.

**Known gap:** pdfjs runs without `cMapUrl`/`standardFontDataUrl`, so PDFs that
depend on external CMaps (CJK and some exotic encodings) may extract poorly.
Fixing it means serving `pdfjs-dist/cmaps` as a static asset.

No server CPU spent on PDF parsing — it scales for free on the client.

---

## 5b. Live notifications (implemented)

`notifications` is in the `supabase_realtime` publication with
`replica identity full` (`supabase/migrations/0006_realtime_notifications.sql`),
so a client sees its own rows appear the moment any node writes one — the
scheduler on Render, or the laptop agent. RLS is evaluated per subscriber, so a
socket can only ever carry its owner's rows.

Clients hold no Supabase credentials, so `GET /me/realtime` hands out the
project URL and the **publishable** key at runtime. That key is designed to be
public, every table behind it is default-deny RLS, and the socket additionally
carries the caller's JWT (`realtime.setAuth`). Serving it keeps the thin-client
property — one configured URL per client — and lets the key rotate without a
client release.

### Reaching a closed app (implemented — Phase 6.2 / 6.4)

Realtime only covers an app that is open. Two more channels close that gap,
and both are driven from **the laptop**, since Phase 11 put the drain loop
there: `backend-local/src/notifications/push.service.ts` writes the
`notifications` row first — that row is the durable record Realtime carries —
and only then tries to reach closed apps. A push that fails never fails the
caller.

| Channel | How | Notes |
|---|---|---|
| **Web Push** | VAPID, `web-push` on the laptop | `frontend/public/sw.js` handles `push` and `notificationclick` only; it is deliberately **not** a caching worker, which would mean reasoning about stale bundles on every deploy. The **public** key is served by `GET /me/push` so nothing is bundled; the **private** key lives only in `backend-local/.env`. |
| **Android** | Expo's push gateway | Filed as `channel_type = 'fcm'` because that is how it is delivered, but the token is an Expo token: their gateway fronts FCM and needs **no server key**, which is what keeps this free. A bare FCM token is refused — FCM v1 wants a signed service-account JWT this project chose not to carry. |

Dead subscriptions are deleted when a push service answers 410/404 or Expo
says `DeviceNotRegistered`; otherwise every future notification would retry
them forever. `notification_channels` is honoured, and a channel with **no**
row counts as enabled — that table records a decision, and its absence is not
a decision to stay silent.

`POST /devices/unregister { token }` exists because a browser that has just
unsubscribed knows its own subscription but not the `device_tokens.id` we
filed it under, and `GET /devices` deliberately never returns tokens.

---

## 6. Gmail — multiple accounts + processing (implemented — Phase 7)

**Render owns all of it**, for one reason: it is the only half holding
`TOKEN_ENCRYPTION_KEY`, so it is the only half that can decrypt a mailbox
token. The laptop calls `POST /internal/gmail/send` when the user approves an
outward action rather than keeping a second copy of the most dangerous
credential in the system — one place to revoke, one place to audit.

- **Connect:** Google Cloud OAuth app; per-account consent; scopes
  `gmail.readonly` + `gmail.send` (never `gmail.modify` — the assistant has no
  need to archive or label, and a scope you cannot use cannot be abused).
  Tokens encrypted with AES-256-GCM (§3) and stored as Postgres **bytea hex
  literals**; writing base64 there stores the characters of the encoding and
  decrypts to nothing.
  - The callback arrives from `accounts.google.com` as a top-level navigation
    with **no session and no bearer token**, so the user is identified by an
    **HMAC-signed, 10-minute `state`** issued at step one. That signature is
    the entire CSRF defence of the connect flow: without it, a crafted
    callback URL would attach a stranger's mailbox to this account.
- **Sync:** initial backfill (4 pages of 50), then **incremental via
  `historyId`**. A 404 from the history endpoint is not an error but an
  instruction — the cursor aged out (Gmail keeps about a week), so it
  backfills instead. The cursor is written *after* the messages it covers, or
  the incremental path would skip them forever.
  - **Request-driven, not cron.** Render is allowed to sleep, so there is no
    tick here to be killed by it; the client syncs when it opens the mail view
    and the laptop syncs on its own tick. Gmail watch → Pub/Sub push would be
    better and needs a Cloud project with a topic — out of scope while the
    OAuth app is unverified.
- **Stored:** who wrote, to whom, subject, Gmail's own snippet, dates and
  flags. **Message bodies are never fetched** (`format=metadata` with a header
  whitelist). Bodies are the bulk of a mailbox and the most sensitive thing in
  it; the assistant's summaries work from the snippet, so not fetching them
  keeps the database inside the free tier and the blast radius small.
- **Process:** `backend-local/src/gmail/email-insights.service.ts` summarises
  on a 10-minute tick, on the laptop, because that is where the model is.
  Email content is **data, never instructions**: the snippet is fenced, the
  system prompt says so, and **no tools are offered on that call**, so even a
  fully successful injection has nothing to reach.
- **Act (confirmed):** sending really sends, behind the existing approval
  gate. The approve route re-validates the parked arguments (a model wrote
  them into a jsonb column some time ago), marks the row approved *before*
  sending — a crash between the two must not leave a message sent and an
  action still pending — then records the outcome in
  `pending_actions.result`. Header values are stripped of CR/LF, since a
  newline in a subject is header injection.
- **Multiple Gmails:** just multiple `gmail_accounts` rows
  (`unique (user_id, email)`), so connecting a second mailbox adds a row and
  reconnecting the same one updates its tokens in place. A refresh that
  returns no new refresh token never overwrites the stored one with null.

⚠️ **The 7-day trap.** An OAuth app left in *Testing* issues refresh tokens
that expire after a week, so the mailbox silently disconnects and the only
symptom is mail going stale. `gmail_accounts.sync_error` is what the Settings
panel reads, so this surfaces as "reconnect this mailbox" rather than an empty
inbox. No code can work around it: publishing the app needs Google's
verification review for the restricted `gmail.readonly` scope.

---

## 7. AI assistant (friend, scheduler, notifier)

- **Persona/charter:** `assistant_persona` holds name, tone, boundaries, check-in time, inactivity threshold. This is the "character" — warm, casual, WhatsApp-style chat.
- **Capabilities = tools** (mirror every web feature): `read_calendar`, `create_event`, `read_tasks`, `create_task`, `search_library`, `open_reader_at`, `read_knowledge`, `summarize_email`, `set_reminder`, `send_notification`. **Health tools** (`read_health`) appear only when a live `health_access_grant` exists.
- **Memory:** `assistant_memory` for durable facts; `assistant_messages` for history; retrieval feeds the prompt.
- **Proactive engine** — the drain loop in `backend-local/src/scheduler/`, not
  a queue. `next_run_at` in the past *is* the pending queue, so there is no
  second concept to get out of step with reality. It runs on boot and every
  minute while the laptop is awake:
  - **Morning brief** at `check_in_time` — today's agenda and open tasks, in
    the persona's voice. The *timing* is the phone's: it arms a local
    notification 48h ahead, so the brief lands at 08:30 with the laptop shut.
    If nothing generated one, the app composes the plain version itself.
  - **Inactivity nudge** — if `now - last_active_at > inactivity_hours` and
    not already nudged in this quiet stretch.
  - **Scheduled actions** from `assistant_schedules` (`notify`, `report`,
    `chat_message`, `email`).
  - A *recurring* job more than `SCHEDULER_STALE_MINUTES` late is **skipped**
    to its next occurrence; one-shots always fire. Catch-up is right for
    syncing and summarising, wrong for anything whose value is its timing.
  - **Important-email alert** when `email_insights.action_needed` — the
    insights exist (Phase 7.5); the alert is Phase 16's Pulse.
- **Channels:** in-app chat (Supabase Realtime) while the app is open; **web
  push** (VAPID) for a closed browser; **Expo push** for the phone; and the
  phone's own **local notifications** for anything scheduled, which is the only
  channel that needs nothing awake anywhere. **Telegram was dropped** (Phase
  6.3): it was chosen as the easy "texts me like a friend" channel, but once
  the in-app chat was continuous and push reached a closed app, a second
  messaging surface added a bot token, a third place for conversation history
  to diverge, and nothing the user actually wanted. WhatsApp Cloud API was
  never started — it needs a Meta business app, a number and template
  approval.
- **Safety:** email/web/PDF content is untrusted; destructive or outward actions (send, delete, post) are confirmed; the assistant reports rather than acts when it hits a wall.

### 7.1 Chat controls (assistant page)

The assistant page becomes **one continuous thread** (`assistant_conversations.is_primary`), with:

| Control | Backing |
|---|---|
| **Context size** — how many previous messages get replayed to the model | `assistant_settings.context_message_limit` (0–200, default 20) |
| **Clear chat** — wipe messages, or archive the thread and start a fresh one | `POST /assistant/clear { mode: 'wipe' \| 'archive' }` |
| **Model / temperature** | `assistant_settings.model`, `.temperature` |
| **Character (charter)** — name, tone, style notes, check-in time, inactivity threshold | `assistant_persona` |
| **Auto-send guard** | `assistant_settings.allow_auto_send_email` (default **off**) |
| **Effort** — how hard it thinks: light / default / deep | `assistant_settings.effort_mode` (default `default`); per-message override `POST /assistant/messages { content, mode }` |

### 7.1a The agent core (Phase 19)

One request may contain several tasks. The agent on LOCAL routes the request to
the capabilities it needs, plans the separate things being asked for, executes
them (reads in parallel where that is safe), then **reconciles every planned
step against the receipt trail** before it writes one reply — so "I added them
to your calendar" is only ever said when `skill_invocations` agrees.

| Table | Holds |
|---|---|
| `agent_plans` | one row per planned turn: request, intent, mode, status, and why those capabilities were offered |
| `agent_plan_steps` | one row per step with its settled status (`verified` / `queued` / `failed` / `not_attempted`) and the invocation that settled it |

Both owner-only RLS, written with the user's own client. Read back at
`GET /assistant/plans`; the capability list at `GET /assistant/capabilities`.
Spec: `docs/AGENT_SPEC.md`.

### 7.2 Scheduled buddy tasks

User-defined jobs: *"every weekday 08:30 report me"*, *"on the 1st email X"*, *"once on Friday text me"*.
`assistant_schedules` + `assistant_schedule_days` (4NF for multi-day weekly) + `schedule_runs` (audit).
Recurrence: `once | daily | weekly | monthly | cron`; actions: `notify | report | email | chat_message`;
channels: `push | telegram | email | in_app`. Full field table in `backend/README.md`.

---

## 8. API surface (v1, REST over Supabase JWT)

**render** — everything except `/assistant/*` and `/skills/*`:

```
/api/v1/auth/signup|login|refresh        POST          (auth is brokered here)
/api/v1/me                               GET/PATCH
/api/v1/me/activity                      POST          (heartbeat → inactivity nudge)
/api/v1/me/realtime                      GET           (project URL + publishable key)
/api/v1/me/push                          GET           (VAPID public key)
/api/v1/library                          GET/POST/PATCH/DELETE
    /:id/annotations  /:id/bookmarks  /:id/reading-sessions  /:id/listening-sessions
    /:id/pdf-text/upload-url|url|confirm POST/GET/POST (signed URLs, brokered)
/api/v1/collections                      GET/POST/PATCH/DELETE  (+ /items/:id)
/api/v1/knowledge                        GET           (derived from annotations)
/api/v1/calendar/events|categories       GET/POST/PATCH/DELETE
/api/v1/tasks                            GET/POST/PATCH/DELETE
/api/v1/health/records                   GET/POST/PATCH/DELETE  (requires grant)
/api/v1/health/grant                     GET/POST/DELETE
/api/v1/notifications                    GET/PATCH     (+ /read-all, /:id/read)
/api/v1/devices                          GET/POST/DELETE
    /unregister                          POST          (withdraw by token)
    /channels                            GET/POST
/api/v1/schedules                        GET/POST/PATCH/DELETE
    /upcoming?hours=48                   GET           (flattened occurrences — the clock)
    /:id/runs                            GET
/api/v1/gmail/status|accounts|messages   GET
    /connect                             POST          (→ Google consent URL)
    /callback                            GET           (no guard: signed `state` is the auth)
    /sync                                POST
    /accounts/:id                        DELETE
/api/v1/nodes/status                     GET           (is the laptop awake?)
/api/v1/internal/gmail/send              POST          (node→node, shared secret)
```

**backend-local** — the laptop, reached directly by the clients:

```
/api/v1/assistant/conversation|messages|settings|persona   GET/POST/PATCH
/api/v1/assistant/clear                                    POST
/api/v1/skills                                             GET
/api/v1/skills/invocations|pending                         GET
/api/v1/skills/pending/:id/approve|reject                  POST
/api/v1/internal/ai/complete                               POST  (node→node)
```

Clients hold **no** Supabase credentials, so nothing hits Supabase directly —
the one exception is the Realtime socket, which uses the publishable key
served at runtime by `GET /me/realtime` and still carries the user's JWT, so
RLS decides what arrives.

---

## 9. Phased roadmap

Superseded by **`docs/PHASES.md`**, which carries every phase, its goal and
its current status in one place. The original seven-phase sketch here assumed
an Oracle VM and an always-on scheduler; both assumptions are gone.

Where it stands: Phases 0–11 are done, Phase 12 (tests — there are still
none) is next, and `docs/PHASES.md` §5 explains the ordering.

---

## 10. Decisions taken

The questions this document originally ended with, and how they were answered:

1. **Backend framework** — NestJS, in both deployables.
2. **Phone messaging channel** — neither Telegram nor WhatsApp. The in-app
   chat is the channel, with web push and Expo push to reach a closed app and
   the phone's own local notifications for anything scheduled.
3. **Auth** — Supabase Auth, email/password, **brokered by render** so clients
   hold no Supabase credentials. Gmail stays a *data* connection, separate
   from login. Social sign-in is not wired in the thin-client model.
4. **Mobile stack** — Expo / React Native, sharing `shared/` with the web.
5. **Raw PDFs in the cloud** — no. Only the extracted JSON and annotations
   sync; the file stays on the device that imported it, and a scanned PDF is
   read there too rather than being uploaded to an OCR service.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
