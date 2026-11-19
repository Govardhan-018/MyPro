-- =====================================================================
-- MyPro — 0010 narrative snapshots (Phase 16 — memory layers)
--
-- The highest-leverage idea in COMPANION_VISION §1: once a week the laptop
-- writes a short third-person sketch of who the user is right now — what
-- they're building, what's heavy, what they've been reading — and that sketch
-- is injected into every prompt thereafter. One generation per week is the
-- whole difference between an assistant that has read your database and one
-- that knows you.
--
-- Semantic facts already live in `assistant_memory` (key/value + confidence +
-- last_used_at, from 0001); this adds the narrative layer on top. Snapshots are
-- immutable — a new one is a new row, and the latest by generated_at wins.
--
-- APPLY BY HAND in the Supabase SQL editor — a commit does not run migrations.
-- =====================================================================

create table if not exists narrative_snapshots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(user_id) on delete cascade,
  content      text not null,
  generated_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists narrative_snapshots_user
  on narrative_snapshots (user_id, generated_at desc);

-- Default deny, owner-only (0002's pattern). No update: snapshots are immutable.
alter table narrative_snapshots enable row level security;
alter table narrative_snapshots force  row level security;
create policy narrative_snapshots_owner_select on narrative_snapshots
  for select using (user_id = auth.uid());
create policy narrative_snapshots_owner_insert on narrative_snapshots
  for insert with check (user_id = auth.uid());
create policy narrative_snapshots_owner_delete on narrative_snapshots
  for delete using (user_id = auth.uid());
