-- =====================================================================
-- MyPro — 0012 the agent core (Phase 19)
--
-- One natural-language request can now become several tasks with an order
-- between them. These two tables are what make that inspectable instead of
-- invisible:
--
--   agent_plans       — one row per planned turn: the request, the intent the
--                       agent read out of it, the effort mode, how routing
--                       chose the capability set, and how it ended.
--   agent_plan_steps  — one row per step, each resolved against the receipt
--                       trail (skill_invocations), never against the model's
--                       own account of itself. This is what "it told me it
--                       added them to my calendar — did it?" is answered from.
--
-- Also: assistant_settings.effort_mode, the user-facing light/default/deep
-- dial that every budget in the agent core derives from.
--
-- APPLY BY HAND in the Supabase SQL editor — a commit does not run migrations.
-- Convention follows 0001 (set_updated_at) and 0002 (default-deny owner RLS).
-- =====================================================================

-- ---- the plan ---------------------------------------------------------
create table if not exists agent_plans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(user_id) on delete cascade,
  conversation_id uuid references assistant_conversations(id) on delete cascade,
  /** The request as the user wrote it, so a plan can be read without the thread. */
  request         text not null,
  /** One line: what the agent understood the request to be. */
  intent          text,
  mode            text not null default 'default',
  status          text not null default 'running',
  step_count      int  not null default 0,
  /** { capabilities: [...], ambiguous: bool, viaModel: bool } — why these tools. */
  routing         jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  constraint agent_plans_mode_check check (mode in ('light', 'default', 'deep')),
  constraint agent_plans_status_check
    check (status in ('running', 'completed', 'partial', 'failed'))
);
create index if not exists agent_plans_user on agent_plans (user_id, created_at desc);
create index if not exists agent_plans_conversation on agent_plans (conversation_id, created_at desc);

-- ---- the steps --------------------------------------------------------
create table if not exists agent_plan_steps (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references agent_plans(id) on delete cascade,
  user_id       uuid not null references profiles(user_id) on delete cascade,
  ordinal       int  not null default 0,
  /** The planner's own id for the step ('s1'), which depends_on refers to. */
  step_key      text not null,
  goal          text not null,
  capability    text not null,
  depends_on    text[] not null default '{}',
  /**
   * pending → then one of:
   *   verified      a successful invocation of that capability exists
   *   queued        parked in pending_actions, waiting on the user
   *   failed        invoked and failed, or denied
   *   not_attempted no invocation at all
   */
  status        text not null default 'pending',
  /** The receipt that settled it: skill_invocations.id. */
  invocation_id uuid,
  detail        text,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint agent_plan_steps_status_check
    check (status in ('pending', 'verified', 'queued', 'failed', 'not_attempted')),
  constraint agent_plan_steps_key_unique unique (plan_id, step_key)
);
create index if not exists agent_plan_steps_plan on agent_plan_steps (plan_id, ordinal);
create index if not exists agent_plan_steps_user on agent_plan_steps (user_id, created_at desc);

-- ---- the effort dial --------------------------------------------------
-- light   one cheap round trip, few capabilities, no planning
-- default the everyday companion: plan, verify, normal context
-- deep    explicit planning, more steps, more memory, more sources
alter table assistant_settings
  add column if not exists effort_mode text not null default 'default';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assistant_settings_effort_mode_check'
  ) then
    alter table assistant_settings
      add constraint assistant_settings_effort_mode_check
      check (effort_mode in ('light', 'default', 'deep'));
  end if;
end $$;

-- ---- RLS: default deny, owner-only -----------------------------------
do $$
declare t text;
begin
  foreach t in array array['agent_plans', 'agent_plan_steps'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %1$I_owner_select on %1$I for select using (user_id = auth.uid())', t);
    execute format('create policy %1$I_owner_insert on %1$I for insert with check (user_id = auth.uid())', t);
    execute format('create policy %1$I_owner_update on %1$I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy %1$I_owner_delete on %1$I for delete using (user_id = auth.uid())', t);
  end loop;
end $$;
