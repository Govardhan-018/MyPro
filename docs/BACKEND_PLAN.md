# MyPro — Backend & Data Architecture Plan

A single intelligent personal space: **Calendar · Library/Reader · Knowledge · Health · AI Assistant**, across **web (now)** and **mobile app (later)**, sharing one backend and one database. The assistant behaves like a friend — it chats, remembers, schedules, and reaches out proactively (morning brief, nudges when you go quiet).

> **Status.** Repo restructured into three deployables (Oracle VM design dropped):
> - `frontend/` — the web app (Vercel), typed API client with **two base URLs**
> - `backend-render/` — always-on core: all CRUD, schedules, scheduler, notifications
> - `backend-local/` — the personal agent on the laptop: assistant chat + LLM,
>   direct Supabase access, 30s heartbeat, `/internal/ai/complete` for render
> - `supabase/migrations/` — 0001 schema (4NF) · 0002 RLS + health gate · 0003 node presence
>
> Offline story: laptop closes → heartbeat stale in ~90s → UI greys the assistant,
> render defers AI jobs (10 min × 3) then sends a plain non-AI message.
>
> Decisions taken: NestJS · Supabase Auth · Telegram-first messaging ·
> Expo later · raw PDFs stay local, JSON + annotations sync.

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
   Android app (Expo, later) ──────────────────┤
        │                                      ▼
        │ /assistant/*               ┌──────────────────┐        ┌──────────────┐
        ▼                            │  backend-render   │───────▶│   Supabase   │
 ┌──────────────────┐  /internal/ai/ │  always-on core   │        │  Postgres +  │
 │  backend-local    │◀──────────────│  CRUD · schedules │        │  Auth +      │
 │  laptop agent     │   complete    │  scheduler ·      │        │  Storage +   │
 │  assistant + LLM  │──────────────▶│  notifications    │        │  Realtime    │
 └────────┬─────────┘   heartbeat    └──────────────────┘        └──────────────┘
          │              (via node_status table)
   Anthropic Claude API
```

| Layer | Choice | Notes |
|---|---|---|
| Web host | **Vercel** | Static SPA (`frontend/`). Two base URLs: `VITE_API_URL` (render) + `VITE_AGENT_URL` (laptop). |
| Mobile | **Expo / React Native** (next) | Shares the TS types + API client; same two base URLs; FCM for push. |
| Core API | **`backend-render/`** on **Render** | NestJS. All CRUD, schedules + minute-tick scheduler, inactivity nudge, notifications, Gmail. `render.yaml` blueprint at repo root. Free tier sleeps — use Starter or a pinger so the scheduler stays awake. |
| Personal agent | **`backend-local/`** on **your laptop** | NestJS. `/assistant/*` + `/internal/ai/complete`. Only holder of the Anthropic key. Heartbeats every 30s into `node_status`. |
| Laptop reachability | **Cloudflare Tunnel** (free) | HTTPS pages cannot call `http://<lan-ip>` (mixed content) and the laptop sits behind NAT — the tunnel gives it a stable HTTPS hostname. |
| Offline story | heartbeat stale >90s | UI greys the assistant (`GET /nodes/status` on render); scheduler defers AI jobs 10 min × 3, then sends a plain non-AI message. |
| DB / Auth / Storage / Realtime | **Supabase** (managed) | Postgres 15, RLS, Supabase Auth (JWT), Storage; clients subscribe to `notifications` via Realtime so messages land instantly whichever node wrote them. |
| AI | **Anthropic Claude API** | Only on the laptop. Model from `ASSISTANT_MODEL` / per-user settings — never hardcoded. |
| CI/CD | GitHub → Vercel (frontend) · GitHub → Render blueprint (core) | The laptop pulls + `npm run build` manually or via a small script. |

**Why this split:** Render is the cheap always-on half, so reminders, nudges and data never depend on the laptop; the laptop is the private, powerful half that holds the LLM key and the agent personality, and the system degrades — never breaks — when it sleeps.

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

**4NF notes:** multivalued facts (a message's labels, an event's reminders, a record's medications/symptoms/documents, a task's tags, a user's phones) each live in their own table — no arrays, no repeating columns, no type-discriminated nullable blobs. Subtype tables keep `library_items` lean. Junctions (`*_tags`, `collection_items`, `email_message_labels`) carry only the relationship.

---

## 5. PDF → JSON (local-first, web + app)

1. User selects a PDF → **parsed on-device** with `pdfjs-dist` (web) / same WASM in Expo.
2. Extract text per page, detect headings/chapters (font-size heuristics), build the structured JSON the reader already consumes (`{ page, chapterTitle, paragraphs[] }`).
3. Store raw PDF **locally** (IndexedDB web / FileSystem app). Store structured JSON locally too.
4. **If cloud sync is on:** upload the JSON + metadata to Supabase Storage (`book_details.pdf_json_path`); annotations always sync (they're small and valuable). The raw PDF uploads only if the user chooses "sync file".
5. Scanned PDFs: OCR status states (`uploading → extracting → organizing → ready → failed`) surfaced in the existing Storage & Sync UI.

No server CPU spent on PDF parsing — it scales for free on the client.

---

## 6. Gmail — multiple accounts + processing

- **Connect:** Google Cloud OAuth app; per-account consent; scopes `gmail.readonly` (upgrade to `gmail.modify` only if we let the assistant archive/label). Tokens encrypted (§3).
- **Sync:** initial backfill, then **incremental via `historyId`**; prefer Gmail **watch → Pub/Sub push** to the API, with polling fallback (cron every N min) for the free tier.
- **Process:** a worker runs each new message through Claude for `email_insights` (summary, category, action_needed). Important/action mail can surface on Today and trigger a notification.
- **Act (confirmed):** "turn this into a task/event" creates a `task`/`calendar_event` + `item_sources` link. Sending replies is a confirmed outward action.
- **Multiple Gmails:** just multiple `gmail_accounts` rows; the Library/Today/Assistant read across all of them for a user.

---

## 7. AI assistant (friend, scheduler, notifier)

- **Persona/charter:** `assistant_persona` holds name, tone, boundaries, check-in time, inactivity threshold. This is the "character" — warm, casual, WhatsApp-style chat.
- **Capabilities = tools** (mirror every web feature): `read_calendar`, `create_event`, `read_tasks`, `create_task`, `search_library`, `open_reader_at`, `read_knowledge`, `summarize_email`, `set_reminder`, `send_notification`. **Health tools** (`read_health`) appear only when a live `health_access_grant` exists.
- **Memory:** `assistant_memory` for durable facts; `assistant_messages` for history; retrieval feeds the prompt.
- **Proactive engine** (BullMQ/cron jobs writing `notifications` + dispatching):
  - **Morning brief** at `check_in_time` — today's agenda, important mail, what to continue reading, one friendly line.
  - **Inactivity nudge** — if `now - last_active_at > inactivity_hours` and not already nudged today, send a friendly "hey, how's it going?" message.
  - **Event/reminder dispatch** from `scheduled_jobs`.
  - **Important-email alert** when `email_insights.action_needed`.
- **Channels:** in-app chat (realtime), **web push** (VAPID) for the browser, **FCM** for the app, and **Telegram bot** as the easy "texts me on my phone like a friend" channel (free, instant, no business verification). *WhatsApp Cloud API is possible later but needs a Meta business app + number + template approval — Telegram first.*
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

### 7.2 Scheduled buddy tasks

User-defined jobs: *"every weekday 08:30 report me"*, *"on the 1st email X"*, *"once on Friday text me"*.
`assistant_schedules` + `assistant_schedule_days` (4NF for multi-day weekly) + `schedule_runs` (audit).
Recurrence: `once | daily | weekly | monthly | cron`; actions: `notify | report | email | chat_message`;
channels: `push | telegram | email | in_app`. Full field table in `backend/README.md`.

---

## 8. API surface (v1, REST over Supabase JWT)

```
/api/v1/library        GET/POST/PATCH/DELETE   (+ /:id/annotations, /:id/sessions)
/api/v1/knowledge      GET                      (derived from annotations)
/api/v1/calendar       GET/POST/PATCH/DELETE
/api/v1/tasks          GET/POST/PATCH/DELETE
/api/v1/gmail/accounts GET/POST/DELETE   /api/v1/gmail/messages GET  /sync POST
/api/v1/health         GET/POST/...  (requires grant)   /api/v1/health/grants POST/DELETE
/api/v1/assistant/conversations ... /messages (SSE/WebSocket stream)
/api/v1/notifications  GET/PATCH   /api/v1/devices POST/DELETE
/api/v1/schedules      GET/POST/PATCH/DELETE
```

Simple web reads may hit Supabase directly (RLS-protected); everything involving secrets, AI, Gmail, or cross-user logic goes through the API.

---

## 9. Phased roadmap

| Phase | Deliverable | Depends on |
|---|---|---|
| **0** | Supabase project, schema + RLS migrations, Supabase Auth wired into the existing web login | — |
| **1** | Persist current web features (library, annotations, reader progress, calendar, health) to Supabase — replace in-memory state | 0 |
| **2** | NestJS API + workers on Oracle VM; JWT verify; `/library` `/calendar` `/tasks` | 0,1 |
| **3** | Local PDF→JSON pipeline + Storage sync + Storage & Sync screen live | 2 |
| **4** | Gmail: one account, then multiple; sync + `email_insights` | 2 |
| **5** | Assistant chat with tools (read/create across features) + persona | 2,4 |
| **6** | Proactive engine: morning brief, inactivity nudge, reminders; web push + Telegram | 5 |
| **7** | Mobile app (Expo) reusing the API; FCM push | 2–6 |

---

## 10. Decisions I need from you

1. **Backend framework:** NestJS (recommended, structured + great for this) vs plain Fastify/Express?
2. **Phone messaging channel first:** **Telegram bot** (recommended — free, instant, easy) vs WhatsApp Cloud API (more setup) vs just web/app push?
3. **Auth:** use **Supabase Auth** for login (recommended; Gmail stays a *data* connection, separate from login) — or log in *with* Google?
4. **Mobile stack:** **Expo / React Native** (recommended, shares TS) vs Flutter?
5. **Do we store raw PDFs in the cloud at all**, or JSON + annotations only (raw PDF always local)?

Tell me 1–5 and I'll turn Phase 0 (Supabase schema + RLS migrations + auth wiring) into the first implementation task.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
