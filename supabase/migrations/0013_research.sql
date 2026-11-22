-- =====================================================================
-- MyPro — 0013 research (Phase 20: internet intelligence)
--
-- Two tables, both **service-role only**:
--
--   research_cache  — content-addressed cache of search results, news,
--                     fixtures, forecasts and extracted pages. Free tiers are
--                     measured in requests per day, and the same question gets
--                     asked twice (once by you, once by the Pulse), so a hit
--                     here is both faster and cheaper. Keyed by a sha256 of
--                     the normalised request, so the same question lands on
--                     the same row whichever provider answers it.
--
--   research_usage  — one row per provider call: which provider, how long it
--                     took, whether it worked, and whether it was served from
--                     cache. This is the quota and reliability record; when a
--                     provider starts failing the only way to know is to have
--                     been counting.
--
-- RLS is enabled and FORCED with **no policies at all**, which is deliberate:
-- the secret key bypasses RLS, so the agent can read and write these, while a
-- user's JWT can read neither. The cached content is public web data, but the
-- queries are personal, and nothing hands them back through the API.
--
-- APPLY BY HAND in the Supabase SQL editor — a commit does not run migrations.
-- =====================================================================

create table if not exists research_cache (
  cache_key   text primary key,
  kind        text not null,                 -- search|news|sports|extract|weather
  provider    text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  constraint research_cache_kind_check
    check (kind in ('search', 'news', 'sports', 'extract', 'weather'))
);
-- The sweep ("delete what has expired") is the only range scan this table gets.
create index if not exists research_cache_expiry on research_cache (expires_at);

create table if not exists research_usage (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null,
  kind        text not null,
  /** Nullable: the Pulse and other background work have no user in flight. */
  user_id     uuid references profiles(user_id) on delete set null,
  ok          boolean not null,
  cached      boolean not null default false,
  duration_ms int,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists research_usage_recent on research_usage (created_at desc);
create index if not exists research_usage_provider on research_usage (provider, created_at desc);

-- ---- no policies: service role only ---------------------------------
do $$
declare t text;
begin
  foreach t in array array['research_cache', 'research_usage'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ---- housekeeping ----------------------------------------------------
-- Nothing calls this yet; Phase 18.1 (retention) is where the drain loop
-- starts sweeping. Until then the cache is small and self-limiting by TTL.
create or replace function sweep_research_cache()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer;
begin
  delete from research_cache where expires_at < now();
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function sweep_research_cache() from public, anon, authenticated;
