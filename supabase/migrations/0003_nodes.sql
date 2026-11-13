-- =====================================================================
-- Two-node topology: always-on "render" (backend-render) and the
-- "local" personal agent (backend-local on the laptop). The laptop
-- heartbeats so render and the UI can tell when it is reachable.
-- =====================================================================

create table node_status (
  node              text primary key check (node in ('render', 'local')),
  base_url          text,
  version           text,
  last_heartbeat_at timestamptz not null default now(),
  detail            jsonb
);

alter table node_status enable row level security;

-- Any signed-in user may read presence (the UI shows "assistant offline").
-- Only the service role writes it — clients can never fake a node being up.
create policy node_status_read on node_status
  for select using (auth.uid() is not null);

-- A schedule whose action needs the AI can be parked until the laptop returns.
alter table schedule_runs
  drop constraint if exists schedule_runs_status_check;
alter table schedule_runs
  add constraint schedule_runs_status_check
  check (status in ('success', 'failed', 'skipped', 'pending_confirmation', 'deferred'));

-- How many times we have deferred this schedule while waiting for the AI,
-- so the core can fall back to a plain message instead of waiting forever.
alter table assistant_schedules
  add column if not exists deferred_count integer not null default 0;
