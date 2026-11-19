-- =====================================================================
-- MyPro — 0009 commitments (Phase 16.1)
--
-- Open loops. A commitment is a thing the user told someone they would do,
-- with a believed deadline and a derived check-in rhythm — distinct from a
-- task, which is a checkbox. It carries a small state machine and a
-- `next_checkin_at` the companion uses to follow up on its own (the moment
-- that makes it feel like a companion rather than a to-do list).
--
-- APPLY BY HAND in the Supabase SQL editor — a commit does not run migrations.
-- Convention follows 0001 (updated_at trigger via set_updated_at) and 0002
-- (default-deny owner-only RLS); the policies are inline here since this table
-- is added after 0002's bulk pass.
-- =====================================================================

create table if not exists commitments (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(user_id) on delete cascade,
  title             text not null,
  detail            text,
  kind              text not null default 'promise',   -- promise|goal|decision|intention
  due_at            timestamptz,
  confidence        smallint not null default 2,       -- 0..3: how sure we are of due_at
  state             text not null default 'open',      -- open|at_risk|done|slipped|abandoned
  source_message_id uuid references assistant_messages(id) on delete set null,
  next_checkin_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  constraint commitments_kind_check       check (kind  in ('promise','goal','decision','intention')),
  constraint commitments_state_check      check (state in ('open','at_risk','done','slipped','abandoned')),
  constraint commitments_confidence_check check (confidence between 0 and 3)
);

create index if not exists commitments_user_state on commitments (user_id, state);
create index if not exists commitments_user_due   on commitments (user_id, due_at);
-- The check-in queue: only live loops are ever scanned for a due follow-up.
create index if not exists commitments_checkin    on commitments (next_checkin_at)
  where state in ('open', 'at_risk');

-- Default deny, owner-only (0002's pattern, inline for this one table).
alter table commitments enable row level security;
alter table commitments force  row level security;
create policy commitments_owner_select on commitments for select using (user_id = auth.uid());
create policy commitments_owner_insert on commitments for insert with check (user_id = auth.uid());
create policy commitments_owner_update on commitments for update using (user_id = auth.uid())
                                                             with check (user_id = auth.uid());
create policy commitments_owner_delete on commitments for delete using (user_id = auth.uid());

create trigger commitments_set_updated_at before update on commitments
  for each row execute function set_updated_at();
