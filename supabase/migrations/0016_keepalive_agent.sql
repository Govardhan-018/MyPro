-- =====================================================================
-- MyPro — 0016 keep the AGENT awake instead of the core
--
-- The agent moved off the laptop onto its own Render service, and that
-- changes which half must never sleep.
--
--   mypro-core   sleeping costs a ~30s cold start on the next screen.
--   mypro-agent  sleeping stops the drain loop, the Pulse, the narrative
--                and episode refreshes and the email summaries. The 8am
--                brief simply never arrives, with no error anywhere.
--
-- Two services, not one, because a free Render instance is 512MB and a
-- fraction of a CPU *per service* — splitting the model work from the CRUD
-- work buys twice the headroom. What it costs is instance hours, which are
-- pooled per account (~750/month at the time of writing, worth checking on
-- your own dashboard). Two services resident around the clock is roughly
-- double that, so confirm the budget before relying on both staying up.
--
-- ---------------------------------------------------------------------
-- BEFORE RUNNING: add the agent's URL to the Vault.
--
--   select vault.create_secret(
--     'https://mypro-agent.onrender.com/api/v1/internal/keepalive',
--     'agent_keepalive_url',
--     'MyPro agent keep-alive endpoint');
--
-- `internal_service_token` is already there from 0015, and the agent uses
-- the same shared secret, so there is nothing else to add.
--
-- Requires 0015 (service_pings, pg_cron, pg_net). Idempotent.
-- APPLY BY HAND in the Supabase SQL editor.
-- =====================================================================

-- ---- the ping --------------------------------------------------------
create or replace function ping_agent()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  target text;
  token  text;
  req_id bigint;
begin
  select decrypted_secret into target
    from vault.decrypted_secrets where name = 'agent_keepalive_url';
  select decrypted_secret into token
    from vault.decrypted_secrets where name = 'internal_service_token';

  if target is null or token is null then
    insert into service_pings (service, outcome, detail)
    values ('render-agent', 'failed',
            'agent_keepalive_url or internal_service_token missing from the Vault');
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

  insert into service_pings (service, request_id, outcome)
  values ('render-agent', req_id, 'pending');
  return req_id;
end $$;

revoke all on function ping_agent() from public, anon, authenticated;

-- `settle_service_pings()` from 0015 already settles every pending row
-- whatever its service, so nothing there needs changing.

-- ---- the schedule ----------------------------------------------------
-- Every 10 minutes, comfortably inside the ~15-minute idle window.
select cron.unschedule('mypro-agent-keepalive')
  where exists (select 1 from cron.job where jobname = 'mypro-agent-keepalive');
select cron.schedule('mypro-agent-keepalive', '*/10 * * * *', $$select ping_agent()$$);

-- ---- the core is woken by the agent now ------------------------------
-- Supabase wakes the agent; the agent wakes the core (CoreKeepAliveService,
-- every 10 minutes, only on the node that owns the clock). Chaining it that
-- way means Supabase needs to know one URL rather than two, and the node
-- that is already awake does the next hop for free.
--
-- So this Supabase-side ping to the core is retired. ping_render_core() is
-- left in place: if you ever stop running the agent, re-schedule it with
--   select cron.schedule('mypro-keepalive', '*/10 * * * *',
--                        $$select ping_render_core()$$);
select cron.unschedule('mypro-keepalive')
  where exists (select 1 from cron.job where jobname = 'mypro-keepalive');

-- ---- checking it ------------------------------------------------------
--   select service, created_at, outcome, status_code, detail
--     from service_pings order by created_at desc limit 20;
--
--   -- is the agent actually up, and is its clock running?
--   select node, base_url, last_heartbeat_at,
--          now() - last_heartbeat_at as staleness
--     from node_status;
--
--   select jobname, schedule, active from cron.job;
