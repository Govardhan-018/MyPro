-- =====================================================================
-- MyPro — 0017 renderable blocks on an assistant message
--
-- A reply used to be one string, so everything a turn found arrived as
-- prose: asked for cricket news, the agent produced an unbroken paragraph
-- containing a team's all-time Test, ODI and T20 records. All of it came
-- from a tool result, as fields, and was flattened into a sentence because
-- a sentence was the only thing available.
--
-- `blocks` holds the structured half: sources with their links and dates,
-- fixtures with teams and venues, a forecast. Built from what the tools
-- actually returned — never from the model's retelling — so a card cannot
-- cite a source that was never fetched.
--
-- Shape (backend-local/src/agent/display-blocks.ts owns it):
--   [ { "kind": "sources",  "from": "news_search", "items": [...] },
--     { "kind": "fixtures", "from": "sports_fixtures", "items": [...] },
--     { "kind": "weather",  "from": "get_weather", "days": [...] } ]
--
-- Nullable and additive: until this is applied the agent still answers,
-- logs a warning, and the cards simply do not persist across a reload.
--
-- APPLY BY HAND in the Supabase SQL editor.
-- =====================================================================

alter table assistant_messages
  add column if not exists blocks jsonb;

comment on column assistant_messages.blocks is
  'Renderable cards derived from this turn''s tool results. Never model-authored.';
