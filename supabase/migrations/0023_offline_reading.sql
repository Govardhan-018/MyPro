-- 0023_offline_reading.sql — reading progress that survives being offline.
--
-- A device that read offline sends its queued progress when it reconnects,
-- possibly hours later. Each position now carries the time it was *recorded*
-- on the device; render keeps whichever is newest (`isStalePosition`), so a
-- late-arriving offline write never rewinds progress made on another device.
--
-- Annotations, bookmarks and sessions need no schema change: the client now
-- sends its own uuid as the row id, and a retried create is recognised as the
-- same row (render `insertOnce`).
--
-- Additive and optional: without it render writes positions as before.
-- Apply by hand in the Supabase SQL editor. Safe to re-run.

alter table book_details    add column if not exists position_updated_at timestamptz;
alter table podcast_details add column if not exists position_updated_at timestamptz;
