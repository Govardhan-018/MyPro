-- 0019_retention.sql — Phase 18.1, the part that keeps the database small.
--
-- MyPro runs on free tiers forever (the first ground rule), and the one thing
-- that grows without bound is logged history: run records, notifications,
-- receipts, the Pulse's suppressed-signal ledger, research usage, email
-- metadata and the raw conversation. None of it is needed indefinitely —
-- memory_episodes already carries the long-term gist of old conversations, and
-- the UI never pages back more than weeks — so here it is pruned on a schedule.
--
-- Two principles:
--   * Only *logs and history* are pruned, never live user content (library,
--     calendar, health, commitments, memory facts, narratives, episodes).
--   * Windows are generous: this is about bounding growth, not forgetting.
--
-- Apply by hand in the Supabase SQL editor — a commit does not run it. Safe to
-- re-run: the function and the cron job are replaced, not duplicated.

-- pg_cron is already enabled by 0015; declared again so this migration stands
-- alone if applied on a fresh project.
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- The one prune pass. SECURITY DEFINER so the cron job (which runs as the
-- table owner, not a user) may delete across every user's rows; it is never
-- granted to anon/authenticated, so no client can call it.
-- ---------------------------------------------------------------------------
create or replace function prune_old_history()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Security trail: a year. Long enough to investigate, bounded all the same.
  delete from audit_log           where created_at  < now() - interval '365 days';

  -- Schedule run history. The UI shows the last 50 per schedule; 120 days is
  -- far more than that in practice.
  delete from schedule_runs       where ran_at      < now() - interval '120 days';

  -- Delivered/!read or not, a half-year-old notification is noise.
  delete from notifications       where created_at  < now() - interval '180 days';

  -- Skill receipts (what the assistant did) — kept long enough to explain a
  -- past answer, then dropped.
  delete from skill_invocations   where created_at  < now() - interval '180 days';

  -- The Pulse's intervention ledger ("what I decided not to tell you"). Its
  -- value is recent; half a year is plenty.
  delete from interventions       where created_at  < now() - interval '180 days';

  -- Per-call research usage accounting — only the recent window informs quota.
  delete from research_usage      where created_at  < now() - interval '90 days';

  -- Deduplication log for interest findings.
  delete from interest_findings   where created_at  < now() - interval '120 days';

  -- Email *metadata* (bodies are never stored). A year of headers is ample for
  -- triage; email_insights cascade with the message row.
  delete from email_messages
    where coalesce(internal_date, created_at) < now() - interval '365 days';

  -- The raw conversation. Old turns are already distilled into memory_episodes
  -- and the weekly narrative, so a year-old message line adds weight without
  -- adding recall.
  delete from assistant_messages  where created_at  < now() - interval '365 days';

  -- Expired research cache (the sweep 0013 defined but never scheduled).
  perform sweep_research_cache();
end $$;

revoke all on function prune_old_history() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Run it once a day, off-peak (03:17 UTC — an odd minute so it does not pile
-- onto every other :00 job). Unschedule any prior copy first so re-applying
-- this migration never leaves two.
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('mypro-retention');
exception when others then
  -- No prior job to remove; that is fine.
  null;
end $$;

select cron.schedule('mypro-retention', '17 3 * * *', $$select prune_old_history()$$);

-- Inspect what the job would remove, before trusting it:
--   select 'assistant_messages' t, count(*) from assistant_messages
--     where created_at < now() - interval '365 days'
--   union all select 'notifications', count(*) from notifications
--     where created_at < now() - interval '180 days';
-- Run it on demand:   select prune_old_history();
-- See it scheduled:   select * from cron.job where jobname = 'mypro-retention';
