-- 0022_scheduler_reliability.sql — the three-mode scheduler, made safe to run.
--
--  1. `device_tokens.armed_at` — when an Android device last armed its local
--     notifications. The laptop's drain loop skips pushing a "Remind me" to a
--     device that already holds it locally, so a reminder never shows twice.
--  2. `schedule_runs.attempt` + 'retrying' — a failed run that will be tried
--     again is recorded as such, with its attempt number, so the history says
--     what actually happened instead of "failed" three times.
--  3. `schedule_runs.result` — the AI reply / the generated email subject, so a
--     run's outcome is preserved next to its status and error detail.
--
-- Everything is additive; old code keeps working against the new schema and
-- the new code degrades without it (render registers devices without
-- `armed_at` if the column is missing).
--
-- Apply by hand in the Supabase SQL editor. Safe to re-run.

alter table device_tokens add column if not exists armed_at timestamptz;

alter table schedule_runs add column if not exists attempt smallint not null default 1;
alter table schedule_runs add column if not exists result text;

alter table schedule_runs drop constraint if exists schedule_runs_status_check;
alter table schedule_runs
  add constraint schedule_runs_status_check
  check (status in ('success', 'failed', 'skipped', 'pending_confirmation', 'deferred', 'retrying'));
