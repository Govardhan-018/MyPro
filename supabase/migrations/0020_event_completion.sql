-- 0020_event_completion.sql — mark a calendar event done.
--
-- An event can now be *completed*, not only edited or deleted. `completed_at`
-- is the single source of truth: null means outstanding, a timestamp means done
-- (and when). The rule for *when* you may mark it — on the day, after it starts,
-- within a ~12h window — is enforced in the API (backend-render calendar
-- service), not here, because it depends on the current time, not the schema.
--
-- Apply by hand in the Supabase SQL editor. Safe to re-run.

alter table calendar_events
  add column if not exists completed_at timestamptz;

-- Outstanding events are what the assistant and the "what do I owe" views care
-- about, so make that the cheap lookup.
create index if not exists calendar_events_outstanding
  on calendar_events (user_id, starts_at)
  where completed_at is null;
