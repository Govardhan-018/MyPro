-- 0025_calendar_item_kind.sql — one store for reminders and events.
--
-- The Calendar's Quick Add now makes either an Event (an appointment, may have
-- an end and a location) or a Reminder (a nudge at a moment, may carry a note
-- in `description`). Both live in `calendar_events`; their "Remind before" lead
-- is the existing `event_reminders.minutes_before`, and the phone arms both
-- through `/schedules/upcoming` exactly as before.
--
-- Additive: every existing row becomes an 'event'. Until this is applied,
-- render stores a reminder as a plain event rather than failing.
-- Apply by hand in the Supabase SQL editor. Safe to re-run.

alter table calendar_events
  add column if not exists kind text not null default 'event';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'calendar_events_kind_check'
  ) then
    alter table calendar_events
      add constraint calendar_events_kind_check check (kind in ('event', 'reminder'));
  end if;
end $$;
