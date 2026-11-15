-- =====================================================================
-- MyPro — allow `deferred` as a schedule run status
--
-- `SchedulerService.deferOrDegrade` has always written a run row with
-- status 'deferred' when a job needed the laptop and the laptop was asleep,
-- but 0001_init.sql's check constraint only permitted
-- success | failed | skipped | pending_confirmation. Postgres rejected every
-- one of those inserts, and because the scheduler never inspected the result,
-- the rejection was silent: defers simply never appeared in run history.
--
-- The status is the honest one to record — the job did not fail, it waited —
-- so the constraint is widened rather than the scheduler changed.
-- =====================================================================

alter table schedule_runs drop constraint if exists schedule_runs_status_check;

alter table schedule_runs
  add constraint schedule_runs_status_check
  check (status in ('success', 'failed', 'skipped', 'pending_confirmation', 'deferred'));