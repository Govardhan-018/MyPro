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
-- Free instance hours are pooled per account (~750/month at the time of
-- writing), and one service resident around the clock is ~730 of them. So
-- this is not a choice between two good options: keep the agent awake and
-- let the core wake on demand. If you move to a paid instance, re-enable
-- the core ping at the bottom of this file.
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

-- ---- stop paying for the core ----------------------------------------
-- Two services kept awake does not fit in the free hour budget. The core
-- is request-driven and holds no cron, so it is the one that sleeps.
select cron.unschedule('mypro-keepalive')
  where exists (select 1 from cron.job where jobname = 'mypro-keepalive');

-- On a paid instance, bring it back with:
--   select cron.schedule('mypro-keepalive', '*/10 * * * *',
--                        $$select ping_render_core()$$);

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
