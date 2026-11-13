-- =====================================================================
-- MyPro — initial schema (4NF)
-- Postgres 15 / Supabase. Run after `supabase init`.
-- Conventions:
--   * uuid PKs, timestamptz everywhere, user_id on every user-owned table
--   * multivalued facts live in their own tables (no arrays / repeating cols)
--   * subtype tables instead of wide nullable "type" tables
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- shared helpers -------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Attach updated_at triggers in bulk at the end of this file.

-- =====================================================================
-- 1. Identity & profile
-- =====================================================================

create table profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar_url   text,
  timezone     text not null default 'UTC',
  locale       text not null default 'en',
  color_mode   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- multivalued -> own table (4NF)
create table user_phone_numbers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(user_id) on delete cascade,
  phone      text not null,
  label      text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, phone)
);

-- presence, for "nudge me when I go quiet"
create table user_activity (
  user_id              uuid primary key references profiles(user_id) on delete cascade,
  last_active_at       timestamptz,
  last_seen_client     text,
  inactive_notified_at timestamptz,
  updated_at           timestamptz not null default now()
);

-- =====================================================================
-- 2. Tags (shared vocabulary, referenced by junctions)
-- =====================================================================

create table tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(user_id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- =====================================================================
-- 3. Gmail (multiple accounts) + processing
-- =====================================================================

create table gmail_accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles(user_id) on delete cascade,
  email              text not null,
  google_sub         text,
  access_token_enc   bytea,
  refresh_token_enc  bytea,
  token_expires_at   timestamptz,
  scopes             text,
  history_id         text,
  watch_expiration   timestamptz,
  sync_state         text not null default 'idle',  -- idle|syncing|error
  sync_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, email)
);

create table email_messages (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(user_id) on delete cascade,
  gmail_account_id  uuid not null references gmail_accounts on delete cascade,
  gmail_message_id  text not null,
  gmail_thread_id   text,
  from_addr         text,
  to_addrs          text,
  subject           text,
  snippet           text,
  internal_date     timestamptz,
  is_read           boolean not null default false,
  is_important      boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (gmail_account_id, gmail_message_id)
);
create index on email_messages (user_id, internal_date desc);

create table email_labels (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(user_id) on delete cascade,
  gmail_account_id uuid not null references gmail_accounts on delete cascade,
  gmail_label_id   text not null,
  name             text,
  unique (gmail_account_id, gmail_label_id)
);

-- M:N resolves the repeating "labels" group
create table email_message_labels (
  email_message_id uuid not null references email_messages on delete cascade,
  email_label_id   uuid not null references email_labels on delete cascade,
  primary key (email_message_id, email_label_id)
);

create table email_attachments (
  id                  uuid primary key default gen_random_uuid(),
  email_message_id    uuid not null references email_messages on delete cascade,
  filename            text,
  mime_type           text,
  size_bytes          bigint,
  gmail_attachment_id text
);

create table email_insights (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(user_id) on delete cascade,
  email_message_id uuid not null unique references email_messages on delete cascade,
  summary          text,
  category         text,                 -- action|fyi|promo|personal|...
  action_needed    boolean not null default false,
  due_hint         timestamptz,
  generated_by     text,
  generated_at     timestamptz not null default now()
);

-- =====================================================================
-- 4. Calendar & tasks
-- =====================================================================

create table event_categories (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  name    text not null,
  tone    text,
  unique (user_id, name)
);

create table calendar_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(user_id) on delete cascade,
  title       text not null,
  description text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default false,
  location    text,
  category_id uuid references event_categories on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on calendar_events (user_id, starts_at);

-- 1:M, not an array (4NF)
create table event_reminders (
  id                uuid primary key default gen_random_uuid(),
  calendar_event_id uuid not null references calendar_events on delete cascade,
  minutes_before    integer not null,
  channel           text not null default 'push',
  unique (calendar_event_id, minutes_before, channel)
);

create table tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(user_id) on delete cascade,
  title      text not null,
  notes      text,
  due_at     timestamptz,
  status     text not null default 'open',   -- open|done|dropped
  priority   smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table task_tags (
  task_id uuid not null references tasks on delete cascade,
  tag_id  uuid not null references tags on delete cascade,
  primary key (task_id, tag_id)
);

-- =====================================================================
-- 5. Library — base + subtype tables (no nullable type-soup)
-- =====================================================================

create table library_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(user_id) on delete cascade,
  type        text not null check (type in ('book','podcast','article','note')),
  title       text not null,
  creator     text,
  status      text not null default 'want',  -- in_progress|completed|want|favorite
  progress    smallint not null default 0 check (progress between 0 and 100),
  cover_url   text,
  tone        text,
  accessed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on library_items (user_id, type, status);

create table book_details (
  library_item_id uuid primary key references library_items on delete cascade,
  total_pages     integer,
  current_page    integer,
  is_physical     boolean not null default false,
  pdf_filename    text,
  pdf_storage     text,                  -- device|sync
  pdf_json_path   text,                  -- Supabase Storage path (structured JSON)
  sync_status     text,                  -- local|synced|uploading|pending
  file_size_bytes bigint,
  last_synced_at  timestamptz
);

create table podcast_details (
  library_item_id      uuid primary key references library_items on delete cascade,
  youtube_url          text,
  channel              text,
  episode_title        text,
  duration_seconds     integer,
  current_time_seconds integer not null default 0,
  playback_speed       numeric(3,2) not null default 1.0
);

create table article_details (
  library_item_id   uuid primary key references library_items on delete cascade,
  source_url        text,
  author            text,
  read_time_minutes integer,
  content_ref       text
);

create table note_details (
  library_item_id uuid primary key references library_items on delete cascade,
  body            text
);

create table collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(user_id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0,
  unique (user_id, name)
);

create table collection_items (
  collection_id   uuid not null references collections on delete cascade,
  library_item_id uuid not null references library_items on delete cascade,
  primary key (collection_id, library_item_id)
);

-- =====================================================================
-- 6. Reader — annotations (logical anchors), bookmarks, sessions
-- =====================================================================

create table annotations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(user_id) on delete cascade,
  library_item_id uuid not null references library_items on delete cascade,
  kind            text not null check (kind in ('note','quote','summary','question','highlight')),
  page            integer,
  paragraph       integer,               -- logical anchor: survives font/zoom/mode
  anchor_text     text,
  title           text,
  body            text,
  color           text,
  chapter         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on annotations (user_id, library_item_id, page);

create table annotation_tags (
  annotation_id uuid not null references annotations on delete cascade,
  tag_id        uuid not null references tags on delete cascade,
  primary key (annotation_id, tag_id)
);

create table bookmarks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(user_id) on delete cascade,
  library_item_id uuid not null references library_items on delete cascade,
  page            integer not null,
  title           text,
  created_at      timestamptz not null default now(),
  unique (library_item_id, page)
);

create table reading_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(user_id) on delete cascade,
  library_item_id uuid not null references library_items on delete cascade,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  start_page      integer,
  end_page        integer,
  notes           text
);

create table listening_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(user_id) on delete cascade,
  library_item_id uuid not null references library_items on delete cascade,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  start_seconds   integer,
  end_seconds     integer
);

-- =====================================================================
-- 7. Provenance — "what created this"
-- =====================================================================

create table item_sources (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(user_id) on delete cascade,
  target_type text not null,             -- task|calendar_event|library_item|...
  target_id   uuid not null,
  source_type text not null,             -- email_message|assistant_message|schedule|...
  source_id   uuid not null,
  created_at  timestamptz not null default now()
);
create index on item_sources (user_id, target_type, target_id);

-- =====================================================================
-- 8. Health — gated, normalized, auditable
-- =====================================================================

create table health_records (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(user_id) on delete cascade,
  name            text not null,
  status          text,
  severity        text,
  started_on      date,
  ended_on        date,
  diagnosis       text,
  doctor          text,
  consultation_on date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table health_symptoms (
  id               uuid primary key default gen_random_uuid(),
  health_record_id uuid not null references health_records on delete cascade,
  name             text not null,
  started_on       date,
  severity         text,
  notes            text
);

create table health_medications (
  id               uuid primary key default gen_random_uuid(),
  health_record_id uuid not null references health_records on delete cascade,
  name             text not null,
  dosage           text,
  frequency        text,
  started_on       date,
  ended_on         date,
  reason           text,
  observations     text
);

create table health_documents (
  id               uuid primary key default gen_random_uuid(),
  health_record_id uuid not null references health_records on delete cascade,
  filename         text not null,
  kind             text,
  storage_path     text
);

-- Explicit, expiring consent for the assistant to read health data.
create table health_access_grants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(user_id) on delete cascade,
  grantee    text not null default 'assistant',
  scope      text not null default 'read' check (scope in ('read','read_write')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index on health_access_grants (user_id, grantee, expires_at);

-- =====================================================================
-- 9. Assistant — persona (charter), settings, continuous chat, memory
-- =====================================================================

create table assistant_persona (
  user_id            uuid primary key references profiles(user_id) on delete cascade,
  name               text not null default 'MyPro',
  tone               text not null default 'warm, casual, like a close friend',
  style_notes        text,                      -- the charter
  check_in_time      time not null default '08:00',
  inactivity_hours   integer not null default 10,
  proactive_enabled  boolean not null default true,
  updated_at         timestamptz not null default now()
);

-- runtime knobs, kept apart from the character
create table assistant_settings (
  user_id               uuid primary key references profiles(user_id) on delete cascade,
  context_message_limit integer not null default 20 check (context_message_limit between 0 and 200),
  -- null = fall back to the server's configured ASSISTANT_MODEL (never hardcoded)
  model                 text,
  temperature           numeric(3,2) not null default 1.0,
  allow_auto_send_email boolean not null default false,  -- outward actions stay off by default
  updated_at            timestamptz not null default now()
);

create table assistant_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(user_id) on delete cascade,
  title           text,
  is_primary      boolean not null default false,   -- the continuous thread
  last_message_at timestamptz,
  archived_at     timestamptz,
  created_at      timestamptz not null default now()
);
create unique index assistant_primary_conversation
  on assistant_conversations (user_id) where is_primary and archived_at is null;

create table assistant_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(user_id) on delete cascade,
  conversation_id uuid not null references assistant_conversations on delete cascade,
  role            text not null check (role in ('user','assistant','tool','system')),
  content         text,
  tool_name       text,
  tool_payload    jsonb,
  token_count     integer,
  created_at      timestamptz not null default now()
);
create index on assistant_messages (conversation_id, created_at desc);

create table assistant_memory (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(user_id) on delete cascade,
  key          text not null,
  value        text not null,
  source       text,
  confidence   numeric(3,2),
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, key)
);

-- =====================================================================
-- 10. Schedules — "do this daily / once / on these days"
-- =====================================================================

create table assistant_schedules (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references profiles(user_id) on delete cascade,
  name                  text not null,
  description           text,
  action_type           text not null
                        check (action_type in ('notify','report','email','chat_message')),
  action_payload        jsonb not null default '{}'::jsonb,
  channel               text not null default 'push'
                        check (channel in ('push','telegram','email','in_app')),
  recurrence            text not null
                        check (recurrence in ('once','daily','weekly','monthly','cron')),
  run_at                timestamptz,          -- recurrence = once
  time_of_day           time,                 -- daily|weekly|monthly
  day_of_month          smallint check (day_of_month between 1 and 31),
  cron_expr             text,                 -- recurrence = cron
  timezone              text not null default 'UTC',
  enabled               boolean not null default true,
  requires_confirmation boolean not null default true,  -- outward actions ask first
  next_run_at           timestamptz,
  last_run_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- a schedule must carry the fields its recurrence needs
  constraint schedule_shape check (
    (recurrence = 'once'    and run_at is not null) or
    (recurrence = 'daily'   and time_of_day is not null) or
    (recurrence = 'weekly'  and time_of_day is not null) or
    (recurrence = 'monthly' and time_of_day is not null and day_of_month is not null) or
    (recurrence = 'cron'    and cron_expr is not null)
  )
);
create index on assistant_schedules (enabled, next_run_at);

-- weekly multi-day selection is multivalued -> own table (4NF)
create table assistant_schedule_days (
  schedule_id uuid not null references assistant_schedules on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),  -- 0 = Sunday
  primary key (schedule_id, day_of_week)
);

create table schedule_runs (
  id          uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references assistant_schedules on delete cascade,
  user_id     uuid not null references profiles(user_id) on delete cascade,
  ran_at      timestamptz not null default now(),
  status      text not null check (status in ('success','failed','skipped','pending_confirmation')),
  detail      text
);
create index on schedule_runs (schedule_id, ran_at desc);

-- internal/system jobs (gmail sync etc.) kept separate from user schedules
create table system_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(user_id) on delete cascade,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  next_run_at timestamptz,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- 11. Notifications & devices
-- =====================================================================

create table notification_channels (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(user_id) on delete cascade,
  type       text not null check (type in ('web_push','fcm','telegram','email')),
  enabled    boolean not null default true,
  unique (user_id, type)
);

create table device_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(user_id) on delete cascade,
  channel_type  text not null check (channel_type in ('web_push','fcm','telegram')),
  token         text not null,            -- push subscription JSON / FCM token / chat id
  platform      text,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, token)
);

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(user_id) on delete cascade,
  title        text not null,
  body         text,
  deeplink     text,
  kind         text,                      -- brief|nudge|reminder|email_alert|schedule
  schedule_id  uuid references assistant_schedules on delete set null,
  delivered_at timestamptz,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);

-- =====================================================================
-- 12. Security audit trail (append-only from the app's perspective)
-- =====================================================================

create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(user_id) on delete set null,
  actor       text not null,              -- 'user'|'assistant'|'system'
  action      text not null,              -- e.g. 'health.read','schedule.execute','email.send'
  target_type text,
  target_id   uuid,
  ip          inet,
  user_agent  text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index on audit_log (user_id, created_at desc);

-- =====================================================================
-- 13. updated_at triggers
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_activity','gmail_accounts','calendar_events','tasks',
    'library_items','annotations','health_records','assistant_persona',
    'assistant_settings','assistant_schedules'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
         for each row execute function set_updated_at()', t, t);
  end loop;
end $$;
