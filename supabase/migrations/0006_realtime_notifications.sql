-- =====================================================================
-- MyPro — in-app notifications over Supabase Realtime (Roadmap Phase 6.1)
--
-- Clients subscribe to their own `notifications` rows and show a toast the
-- moment any node writes one (the scheduler on render, or the laptop agent).
-- One mechanism for web and Android, and no push infrastructure needed while
-- the app is open.
--
-- Realtime only replicates tables in its publication, and it evaluates the
-- subscriber's RLS policies for every change — `notifications_owner_select`
-- (0002_rls.sql) is what keeps a socket to another user's rows empty.
-- =====================================================================

-- `replica identity full` so UPDATE/DELETE payloads carry the whole row
-- (otherwise only the primary key arrives, and a read receipt from another
-- device could not be matched to the toast it should dismiss).
alter table notifications replica identity full;

do $$
begin
  -- Supabase creates this publication for every project; create it if a
  -- self-hosted instance has not.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
