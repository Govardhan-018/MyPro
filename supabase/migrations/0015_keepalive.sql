-- =====================================================================
-- MyPro — 0015 keep Render awake (the deployment half of Phase 20.8)
--
-- Render's free web service sleeps after ~15 minutes with no inbound
-- request, and waking it costs ~30 seconds on the next screen you open.
-- Supabase can do the waking: pg_cron fires every 10 minutes and pg_net
-- posts to the core's /internal/keepalive, which answers and records that
-- it answered. No paid plan, no third-party uptime service.
--
-- What this is NOT: a scheduler. The ping does no AI work and runs no jobs.
-- The clock still lives on the laptop (Phase 11). Confusing the two is how
-- you end up with two schedulers racing for the same rows.
--
-- ---------------------------------------------------------------------
-- BEFORE RUNNING: set the two secrets in the Vault, from the SQL editor.
-- They are read back only inside the function below, never selected by the
-- app, and never stored in this file:
--
--   select vault.create_secret(
--     'https://<your-service>.onrender.com/api/v1/internal/keepalive',
--     'keepalive_url',
--     'Render core keep-alive endpoint');
--
--   select vault.create_secret(
--     '<the same INTERNAL_SERVICE_TOKEN as backend-render/.env>',
--     'internal_service_token',
--     'node-to-node shared secret');
--
-- To rotate either later:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'keepalive_url'),
--     '<new value>');
--
-- APPLY BY HAND in the Supabase SQL editor — a commit does not run
-- migrations. Everything below is idempotent; running it twice is safe.
-- =====================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---- the ledger ------------------------------------------------------
-- "Record health-check status and failures": without this the keep-alive is
-- invisible, and an endpoint that has been 500ing for a week looks exactly
-- like one that is working.
create table if not exists service_pings (
  id          bigint generated always as identity primary key,
  service     text not null default 'render-core',
  /** pg_net is asynchronous: the response arrives later, under this id. */
  request_id  bigint,
  status_code int,
  /** ok | failed | pending | unreachable */
  outcome     text not null default 'pending',
  detail      text,
  duration_ms int,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz,
  constraint service_pings_outcome_check
    check (outcome in ('ok', 'failed', 'pending', 'unreachable'))
);
create index if not exists service_pings_recent on service_pings (created_at desc);
create index if not exists service_pings_open on service_pings (request_id)
  where outcome = 'pending';

-- Service-role only: this is operational telemetry, not user data. RLS on
-- with no policies means a user's JWT reads nothing here.
alter table service_pings enable row level security;
alter table service_pings force row level security;

-- ---- the ping --------------------------------------------------------
create or replace function ping_render_core()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  target  text;
  token   text;
  req_id  bigint;
begin
  select decrypted_secret into target
    from vault.decrypted_secrets where name = 'keepalive_url';
  select decrypted_secret into token
    from vault.decrypted_secrets where name = 'internal_service_token';

  -- Missing secrets are recorded rather than raised: a cron job that throws
  -- every ten minutes is noise, and the row says exactly what is wrong.
  if target is null or token is null then
    insert into service_pings (outcome, detail)
    values ('failed', 'keepalive_url or internal_service_token missing from the Vault');
    return null;
  end if;

  select net.http_post(
           url     := target,
           headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'x-internal-token', token),
           body    := jsonb_build_object('source', 'supabase-cron'),
           timeout_milliseconds := 20000
         )
    into req_id;

  insert into service_pings (request_id, outcome) values (req_id, 'pending');
  return req_id;
end $$;

revoke all on function ping_render_core() from public, anon, authenticated;

-- ---- settle the results ----------------------------------------------
-- pg_net answers asynchronously into net._http_response, so a second pass
-- joins the reply back to the ping. Without this every row stays 'pending'
-- and the ledger tells you nothing.
create or replace function settle_service_pings()
returns integer
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  settled integer := 0;
begin
  update service_pings p
     set status_code = r.status_code,
         outcome     = case
                         when r.status_code between 200 and 299 then 'ok'
                         when r.status_code is null then 'unreachable'
                         else 'failed'
                       end,
         detail      = coalesce(r.error_msg, left(r.content, 300)),
         settled_at  = now(),
         duration_ms = extract(milliseconds from (now() - p.created_at))::int
    from net._http_response r
   where r.id = p.request_id
     and p.outcome = 'pending';
  get diagnostics settled = row_count;

  -- A ping with no reply after five minutes is never getting one: the
  -- service was unreachable, which is precisely what we want to know.
  update service_pings
     set outcome = 'unreachable',
         detail  = coalesce(detail, 'no response within 5 minutes'),
         settled_at = now()
   where outcome = 'pending'
     and created_at < now() - interval '5 minutes';

  -- Two weeks of history is plenty to answer "has it been up?".
  delete from service_pings where created_at < now() - interval '14 days';

  return settled;
end $$;

revoke all on function settle_service_pings() from public, anon, authenticated;

-- ---- the schedule ----------------------------------------------------
-- Every 10 minutes: comfortably inside Render's ~15-minute idle window,
-- and 144 pings a day is nothing for either service.
select cron.unschedule('mypro-keepalive')
  where exists (select 1 from cron.job where jobname = 'mypro-keepalive');
select cron.schedule('mypro-keepalive', '*/10 * * * *', $$select ping_render_core()$$);

-- Settling runs on the odd minutes so it never collides with the ping.
select cron.unschedule('mypro-keepalive-settle')
  where exists (select 1 from cron.job where jobname = 'mypro-keepalive-settle');
select cron.schedule('mypro-keepalive-settle', '5-55/10 * * * *', $$select settle_service_pings()$$);

-- ---- how to check it is working --------------------------------------
--   select created_at, outcome, status_code, detail
--     from service_pings order by created_at desc limit 20;
--
--   -- uptime over the last day
--   select outcome, count(*) from service_pings
--    where created_at > now() - interval '1 day' group by outcome;
--
--   -- the jobs themselves
--   select jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--
-- To stop keeping it awake (e.g. you moved to a paid always-on plan):
--   select cron.unschedule('mypro-keepalive');
--   select cron.unschedule('mypro-keepalive-settle');
