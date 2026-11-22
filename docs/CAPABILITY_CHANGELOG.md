# Capability changelog

One line per capability change that a caller could notice: a new capability, a
removed one, a renamed or retyped argument, a tier change, a behaviour change.
Versions are `capabilities/capability.meta.ts`; the behaviour is
`skills/definitions.ts`. Newest first.

Why this file: the agent picks capabilities by description and the planner
names them by id, so a quiet rename or tier change is a routing regression that
nothing else records. `docs/AGENT_SPEC.md` is the spec; this is the history.

## 2026-11-22 — Phase 20.5 / 20.6, training and interests

- **Added** `list_activities` (read, category `fitness`) — Strava, through
  render, read-only.
- **Added** `follow_interest` (write), `list_interests` (read),
  `update_interest` (write), category `interests`.
- **Added** categories `fitness` and `interests`.
- **Changed, non-breaking**: `SkillContext` gained `fitness`.
- **Routing fix, worth knowing**: `create_event`'s keywords missed "add
  **them** to my calendar" because the phrase match is a substring. It now
  matches `calendar` and several natural phrasings. A capability the router
  cannot reach is a capability the planner cannot plan, so routing vocabulary
  is a correctness concern, not a nicety.

## 2026-11-22 — Phase 20, the internet

- **Added** a sixth news provider path: `rss` (keyless, feeds you nominate),
  ahead of `gdelt` in the chain.
- **Added** five capabilities, all `read`, all version 1.0.0:
  `web_search` (research), `news_search` (news), `fetch_page` (research),
  `sports_fixtures` (sports), `get_weather` (weather).
- **Added** three capability categories: `news`, `sports`, `weather`. They are
  separate from `research` on purpose — the planner treats a request spanning
  two categories as worth an agenda, and "check the fixtures and put them in
  my calendar" should plan.
- **Changed, non-breaking**: `SkillContext` gained `research` and `budget`.
  Existing skills ignore both. A research skill with no configured provider
  throws a readable refusal rather than failing.
- Every research result carries an `untrusted` field as its first key. Treat
  removing it as a breaking change: it is a safety control, not a comment.

## 2026-11-22 — Phase 19, the agent core

- **No capability changed.** All 28 skills keep their name, arguments, tier
  and behaviour. This is the point: the agent core was added *around* the
  registry, not through it.
- All 28 gained routing metadata at version **1.0.0** (category, request
  vocabulary, dependencies). `get_now` is the only `always: true` capability.
- Tiers are unchanged and still read from each skill's own `sideEffect`:
  10 `read`, 17 `write`, 1 `outward` (`send_email`). Only the 10 reads are
  eligible for parallel execution.
- New rule: a capability may now be **retired without deleting code** by
  setting `enabled: false` in its metadata. Nothing uses this yet.

### Conventions

- Bump the **patch** version for a description or keyword change (routing only).
- Bump the **minor** version for a new optional argument or a wider result.
- Bump the **major** version for a renamed or removed argument, a changed
  result shape, or a tier change — and say so here, because the model's
  habits and any stored plan referring to it are both affected.
- A tier moving *up* (`read` → `write` → `outward`) is a safety change and is
  never a patch.
