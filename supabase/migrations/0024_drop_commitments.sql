-- 0024_drop_commitments.sql — retire the Commitments feature.
--
-- Commitments (0009) is removed from every layer: the web view, render's
-- endpoints, the agent's three skills, the Pulse check-in signal and the
-- assistant's register. Nothing reads or writes the table any more, so it
-- goes too. The register now reads open/done tasks instead.
--
-- DESTRUCTIVE: any saved commitments are deleted for good. Export them first
-- (`select * from commitments`) if you want a copy.
--
-- Earlier migrations that mention commitments (0009, 0011, 0019) stay as
-- history; this file is what supersedes them.
-- Apply by hand in the Supabase SQL editor. Safe to re-run.

drop table if exists commitments cascade;
