-- =====================================================================
-- MyPro — 0014 Strava and interests (Phase 20.5 / 20.6)
--
--   strava_accounts   — one Strava connection per person, tokens encrypted
--                       at rest exactly like gmail_accounts. Lives on render
--                       because the OAuth redirect URI must be stable and
--                       TOKEN_ENCRYPTION_KEY exists only there.
--
--   interests         — the things you actually follow: a team, a player, a
--                       company, a topic. The distinction from
--                       assistant_memory matters: memory records that
--                       something is true about you ("favourite team: India"),
--                       an interest is a standing instruction to go and look.
--                       Memory is read when it comes up; an interest is
--                       *checked on a schedule*.
--
--   interest_findings — what each check turned up, so the same story is never
--                       delivered twice. Deduplication is the whole
--                       difference between a companion and a spam bot.
--
-- APPLY BY HAND in the Supabase SQL editor — a commit does not run migrations.
-- =====================================================================

-- ---- Strava ----------------------------------------------------------
create table if not exists strava_accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(user_id) on delete cascade,
  athlete_id        text,
  athlete_name      text,
  /** AES-256-GCM, as iv||tag||ciphertext. Worthless without the key. */
  access_token_enc  bytea,
  /** Strava ROTATES this on every refresh; storing the new one is mandatory. */
  refresh_token_enc bytea,
  token_expires_at  timestamptz,
  scopes            text,
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id)
);

-- ---- what you follow --------------------------------------------------
create table if not exists interests (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references profiles(user_id) on delete cascade,
  /** team|player|company|technology|person|topic|other */
  category             text not null default 'topic',
  /** The thing itself, as the user says it: "India", "Jasprit Bumrah". */
  entity               text not null,
  /** Other spellings, so a headline about "Team India" still matches. */
  aliases              text[] not null default '{}',
  /** 1 mildly curious … 5 tell me quickly. Drives urgency, not frequency. */
  interest_level       int  not null default 3,
  /**
   * 0..1. How important a development must be before it is worth a push.
   * High for a company you merely track, low for the team you care about.
   */
  importance_threshold numeric(3,2) not null default 0.5,
  /** push | chat | none — none means "collect it, do not interrupt me". */
  notify               text not null default 'chat',
  /** How often it may be checked, in hours. */
  check_every_hours    int  not null default 24,
  active               boolean not null default true,
  last_checked_at      timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint interests_category_check
    check (category in ('team','player','company','technology','person','topic','other')),
  constraint interests_notify_check check (notify in ('push','chat','none')),
  constraint interests_level_check check (interest_level between 1 and 5),
  constraint interests_threshold_check check (importance_threshold between 0 and 1),
  constraint interests_every_check check (check_every_hours between 1 and 720),
  /** One row per thing. Following "India" twice is a bug, not a feature. */
  unique (user_id, category, entity)
);
create index if not exists interests_due
  on interests (user_id, active, last_checked_at);

-- ---- what each check found -------------------------------------------
create table if not exists interest_findings (
  id            uuid primary key default gen_random_uuid(),
  interest_id   uuid not null references interests(id) on delete cascade,
  user_id       uuid not null references profiles(user_id) on delete cascade,
  title         text not null,
  url           text,
  publisher     text,
  published_at  timestamptz,
  /**
   * sha256 of the normalised URL (or the title when there is no URL).
   * The unique index on it is what stops the same story arriving twice from
   * two providers, or again tomorrow because it is still in the feed.
   */
  fingerprint   text not null,
  /** 0..1, how much this looked like it mattered. */
  importance    numeric(3,2),
  /** delivered | suppressed | stored */
  outcome       text not null default 'stored',
  reason        text,
  created_at    timestamptz not null default now(),
  constraint interest_findings_outcome_check
    check (outcome in ('delivered', 'suppressed', 'stored'))
);
create unique index if not exists interest_findings_dedupe
  on interest_findings (interest_id, fingerprint);
create index if not exists interest_findings_recent
  on interest_findings (user_id, created_at desc);

-- ---- RLS: default deny, owner-only -----------------------------------
do $$
declare t text;
begin
  foreach t in array array['strava_accounts', 'interests', 'interest_findings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %1$I_owner_select on %1$I for select using (user_id = auth.uid())', t);
    execute format('create policy %1$I_owner_insert on %1$I for insert with check (user_id = auth.uid())', t);
    execute format('create policy %1$I_owner_update on %1$I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy %1$I_owner_delete on %1$I for delete using (user_id = auth.uid())', t);
  end loop;
end $$;

-- The token columns are never selected by a user-scoped client, but make the
-- intent explicit: these are readable only with the service key.
revoke select (access_token_enc, refresh_token_enc) on strava_accounts from anon, authenticated;

create trigger strava_accounts_set_updated_at before update on strava_accounts
  for each row execute function set_updated_at();
create trigger interests_set_updated_at before update on interests
  for each row execute function set_updated_at();
