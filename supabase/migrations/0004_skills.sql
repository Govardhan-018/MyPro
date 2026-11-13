-- =====================================================================
-- Skills & receipts.
--
-- The skill *registry* lives in code (backend-local/src/skills) so the
-- schema and handler can never drift apart. What the database holds is
-- the receipt trail: every invocation, and every outward action waiting
-- for your approval.
-- =====================================================================

create table skill_invocations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(user_id) on delete cascade,
  conversation_id uuid references assistant_conversations on delete set null,
  message_id      uuid references assistant_messages on delete set null,
  skill           text not null,
  side_effect     text not null check (side_effect in ('read', 'write', 'outward')),
  args            jsonb not null default '{}'::jsonb,
  result          jsonb,
  status          text not null
                  check (status in ('success', 'failed', 'needs_approval', 'denied')),
  error           text,
  duration_ms     integer,
  created_at      timestamptz not null default now()
);
create index on skill_invocations (user_id, created_at desc);
create index on skill_invocations (conversation_id, created_at);

-- Outward or irreversible actions park here until you say yes.
create table pending_actions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(user_id) on delete cascade,
  invocation_id uuid references skill_invocations on delete set null,
  skill         text not null,
  args          jsonb not null default '{}'::jsonb,
  summary       text,                     -- human-readable "what will happen"
  state         text not null default 'pending'
                check (state in ('pending', 'approved', 'rejected', 'expired')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  expires_at    timestamptz not null default (now() + interval '24 hours')
);
create index on pending_actions (user_id, state, created_at desc);

-- ---------------------------------------------------------------------
-- RLS: owner-only, same shape as everything else.
-- ---------------------------------------------------------------------
alter table skill_invocations enable row level security;
alter table skill_invocations force row level security;
alter table pending_actions enable row level security;
alter table pending_actions force row level security;

create policy skill_invocations_owner_select on skill_invocations
  for select using (user_id = auth.uid());
create policy skill_invocations_owner_insert on skill_invocations
  for insert with check (user_id = auth.uid());

-- Receipts are a record of what happened: no update, no delete.

create policy pending_actions_owner_select on pending_actions
  for select using (user_id = auth.uid());
create policy pending_actions_owner_insert on pending_actions
  for insert with check (user_id = auth.uid());
create policy pending_actions_owner_update on pending_actions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
