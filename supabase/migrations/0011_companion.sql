-- =====================================================================
-- MyPro — 0011 companion layers (Phase 16: the rest of level 4)
--
-- Three tables that finish the companion:
--   memory_episodes   — episodic memory: a short summary of a stretch of
--                       conversation, so the agent remembers "on 3 Oct you
--                       were stuck on the auth refactor" months later.
--   interventions     — the Pulse's ledger: every candidate the agent scored,
--                       whether it was sent or suppressed and why. Being able
--                       to ask "what did you decide not to tell me today?" is
--                       the trust feature; it is also the tuning surface.
--   attention_threads — the handful of live concerns a life has at any moment
--                       (the Friday project, the knee, the job application),
--                       so the companion can say "about the Friday project —".
--
-- APPLY BY HAND in the Supabase SQL editor — a commit does not run migrations.
-- Convention follows 0001 (set_updated_at) and 0002 (default-deny owner RLS).
-- =====================================================================

-- ---- episodic memory -------------------------------------------------
create table if not exists memory_episodes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(user_id) on delete cascade,
  summary       text not null,
  message_count int not null default 0,
  period_start  timestamptz,
  period_end    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists memory_episodes_user on memory_episodes (user_id, created_at desc);

-- ---- the Pulse ledger -------------------------------------------------
create table if not exists interventions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(user_id) on delete cascade,
  signal_type      text not null,                 -- commitment|task|email|silence|evening|weekly
  payload          jsonb not null default '{}',
  urgency          numeric(4,3),
  value            numeric(4,3),
  novelty          numeric(4,3),
  score            numeric(5,4),
  outcome          text not null,                 -- sent|suppressed|expired
  suppressed_reason text,                         -- budget|cooldown|low_score
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists interventions_user on interventions (user_id, created_at desc);
create index if not exists interventions_user_type on interventions (user_id, signal_type, created_at desc);

-- ---- attention threads ------------------------------------------------
create table if not exists attention_threads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(user_id) on delete cascade,
  title           text not null,
  kind            text not null default 'other',  -- project|topic|health|admin|other
  state           text not null default 'active',  -- active|dormant|closed
  summary         text,
  last_touched_at timestamptz not null default now(),
  next_checkin_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint attention_threads_state_check check (state in ('active', 'dormant', 'closed'))
);
create index if not exists attention_threads_user on attention_threads (user_id, state, last_touched_at desc);

-- ---- RLS: default deny, owner-only -----------------------------------
do $$
declare t text;
begin
  foreach t in array array['memory_episodes', 'interventions', 'attention_threads'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %1$I_owner_select on %1$I for select using (user_id = auth.uid())', t);
    execute format('create policy %1$I_owner_insert on %1$I for insert with check (user_id = auth.uid())', t);
    execute format('create policy %1$I_owner_update on %1$I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy %1$I_owner_delete on %1$I for delete using (user_id = auth.uid())', t);
  end loop;
end $$;

create trigger attention_threads_set_updated_at before update on attention_threads
  for each row execute function set_updated_at();
