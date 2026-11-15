-- =====================================================================
-- MyPro — record what happened when an outward action was approved
--
-- Phase 7.6 makes `send_email` really send. Until now approving an action
-- only moved `state` to 'approved', which was honest while nothing could
-- execute: there was no outcome to record.
--
-- Now there is, and the two cases are different in a way the user must be
-- able to see. "Approved and sent from you@example.com" and "approved, but
-- that mailbox needs reconnecting" are both `state = 'approved'`, and
-- without somewhere to put the outcome the second one looks exactly like
-- the first — the user would believe a message went out that never did.
--
-- Deliberately plain text, not jsonb: it is read by a person in the
-- approvals queue, never queried.
-- =====================================================================

alter table pending_actions
  add column if not exists result text;

comment on column pending_actions.result is
  'What happened when this action was approved and executed — shown to the user. Null while pending.';
