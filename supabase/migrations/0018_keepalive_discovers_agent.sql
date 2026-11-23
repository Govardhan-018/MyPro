-- =====================================================================
-- MyPro — 0018 the keep-alive needs no setup at all
--
-- Symptom: the agent kept going to sleep, and a health check took 27
-- seconds because it was a cold start rather than a request.
--
-- Cause, read straight out of service_pings:
--
--   03:40:00  failed  req=None  agent_keepalive_url or internal_service_token
--                               missing from the Vault
--
-- The cron was running perfectly every ten minutes. It just had nothing to
-- call. 0016 asked for two Vault secrets to be created by hand, and a setup
-- step that is easy to miss is a setup step that will be missed.
--
-- This removes both of them.
--
--   The ADDRESS is discovered. The agent already publishes its own URL to
--   `node_status` every 30 seconds — that is how render and the web app
--   find it, and AGENTS.md states the rule: the address is discovered,
--   never hardcoded. The keep-alive now follows the same rule, so it also
--   survives the agent being renamed, moved, or put back behind a tunnel.
--
--   The TOKEN is gone. It was protecting nothing. *Any* HTTP request wakes
--   a sleeping instance — a 404 would do it — so requiring a shared secret
--   to send one adds a failure mode and buys no security. The ping is now
--   an unauthenticated GET to the liveness endpoint, which returns
--   {"status":"ok"} and reveals nothing. The POST that writes node_status
--   stays guarded, and the agent's own heartbeat already covers it.
--
-- Net effect: nothing to configure, so nothing to forget.
--
-- APPLY BY HAND in the Supabase SQL editor. Requires 0015 and 0016.
-- =====================================================================

create or replace function ping_agent()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  target text;
  req_id bigint;
begin
  -- An explicit override, if one was ever set. Otherwise ask the agent
  -- where it is. It upserts this every 30s; a stale value simply means it
  -- is already asleep, and that address is still how you wake it.
  select decrypted_secret into target
    from vault.decrypted_secrets where name = 'agent_keepalive_url';

  if target is null then
    select rtrim(base_url, '/') || '/api/v1/internal/keepalive'
      into target
      from node_status
     where node = 'local'
       and base_url is not null
       and base_url like 'http%';
  end if;

  if target is null then
    insert into service_pings (service, outcome, detail)
    values (
      'render-agent',
      'failed',
      'no agent address: node_status has no base_url for node=''local''. ' ||
      'Has the agent started at least once with PUBLIC_BASE_URL set?'
    );
    return null;
  end if;

  -- GET, unauthenticated, because waking a service is not a privileged act.
  select net.http_get(
           url := target,
           -- A sleeping free instance takes ~30s to wake, and waking it is
           -- the entire point. A shorter timeout fails on exactly the
           -- occasions the ping was needed.
           timeout_milliseconds := 45000
         )
    into req_id;

  insert into service_pings (service, request_id, outcome)
  values ('render-agent', req_id, 'pending');
  return req_id;
end $$;

revoke all on function ping_agent() from public, anon, authenticated;

-- A pending ping now has 45s plus wake time, so give the settler room
-- before it declares something unreachable.
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

  update service_pings
     set outcome = 'unreachable',
         detail  = coalesce(detail, 'no response within 8 minutes'),
         settled_at = now()
   where outcome = 'pending'
     and created_at < now() - interval '8 minutes';

  delete from service_pings where created_at < now() - interval '14 days';

  return settled;
end $$;

revoke all on function settle_service_pings() from public, anon, authenticated;

-- ---- check it now, rather than waiting ten minutes -------------------
--   select ping_agent();            -- a request id, not null
--   select pg_sleep(30);
--   select settle_service_pings();
--   select service, outcome, status_code, duration_ms, detail
--     from service_pings order by created_at desc limit 3;
--
-- A first ping that reads 'unreachable' is expected when the service was
-- asleep — it woke it, and took longer than the wait. Ten minutes later it
-- should read 'ok' with a status code of 200.
