# MyPro — the agent core, as built

**Phase 19.** This is the descriptive spec of the agent core in
`backend-local/src/agent/` and `backend-local/src/capabilities/`, written the
same way as `docs/AI_SYSTEM.md`: every number and path was read out of the
source. Where this and any other doc disagree, the code wins and this file
follows it.

Read `docs/AI_SYSTEM.md` first for the system this sits inside, and
`docs/RESEARCH_PROVIDERS.md` for the research provider layer (Phase 20),
which plugs into this one as five ordinary capabilities — no special path.

---

## 1. The milestone this exists for

> One natural-language request → decide which capabilities are needed →
> execute several tasks → verify the results → return one coherent response.
> And speak first, like a friend, when it is worth saying something.

What the system did before Phase 19: offered all 28 skills to the model on
every call, let it chain up to 6 tool steps, and returned whatever it said at
the end. No notion of what the request *asked for*, so a three-part request
could quietly become a one-part answer with a confident tone.

What it does now:

```
request
  → intent routing        which capabilities could this possibly need?
  → planning              what are the separate things being asked for?
  → execution             tool loop, parallel where it is safe
  → verification          which plan steps do the receipts actually support?
  → one answer            written against that verdict, not against memory
```

Each stage is optional and each degrades into the stage below. A short
question in Light mode still costs exactly one model call — the same as before
this layer existed.

---

## 2. Source map

```
backend-local/src/
  capabilities/
    capability.types.ts       Capability, CapabilityMeta, categories
    capability.meta.ts        routing metadata for all 28 skills
    capability.routing.ts     PURE: keyword scoring + selection
    capability.registry.ts    skills ⋈ metadata, filtered by grant
    capabilities.module.ts

  agent/
    effort.ts                 PURE: the three modes and every budget
    plan.types.ts             the plan schema (zod) and step outcomes
    plan-trigger.ts           PURE: is this request worth planning?
    verification.ts           PURE: reconcile(plan, receipts)
    intent-router.service.ts  keyword pass, then one small model call
    planner.service.ts        the agenda; `parse` is pure and tested
    execution.service.ts      the tool loop, parallel reads, honest exhaustion
    plan.store.ts             agent_plans / agent_plan_steps persistence
    agent-core.service.ts     the orchestrator
    agent.module.ts

  pulse/local-day.ts          PURE: the user's day, not Greenwich's
```

`AssistantService.converse()` is **gone**; `AgentCoreService.run()` replaced
it. `MAX_TOOL_STEPS = 6` is gone too — it lives in the budget table now.

---

## 3. Capabilities

A capability is a skill plus the metadata needed to *choose* it. The
executable registry (`skills/definitions.ts`) is still the only definition of
what a skill does; `capability.meta.ts` adds only routing information:

| Field | Purpose |
|---|---|
| `name` | must equal the skill's name |
| `version` | semver; bump on an argument or behaviour change a caller would notice |
| `category` | `time`, `calendar`, `tasks`, `commitments`, `memory`, `library`, `knowledge`, `health`, `notifications`, `schedules`, `email`, `research`, `other` |
| `keywords` | the request vocabulary — words the sentence needing this would contain |
| `dependencies` | what is usually needed first (`create_event` → `list_events`) |
| `always` | offered on every request. Currently `get_now` only |
| `enabled` | `false` removes it from routing without deleting code |

`permission` is not duplicated here — it is read from the skill's own
`sideEffect`, because the tier is a safety decision and must have one home.

**Coverage is enforced by test, not by convention.**
`test/capability-registry.test.ts` fails if a skill has no metadata, if
metadata names a skill that does not exist, if a dependency points nowhere, or
if the always-on set grows. Adding skill 29 without routing vocabulary is a
red test, not a silent regression. At runtime a missing entry only logs a
warning and falls back to name-derived keywords — a new skill is weakly
routable, never unreachable.

---

## 4. Intent routing

`capability.routing.ts` (pure, free):

- phrase keyword (contains a space) → substring match, weight **2**
- single-word keyword → word-boundary match, weight **1** (`event` does not
  match `eventually`)
- `always` capabilities score 1000 and therefore rank first
- every matched capability pulls its `dependencies` in at a floor of **0.4**,
  so they rank below anything the request actually named
- `ambiguous` is set when fewer than `minConfident` (1) capabilities matched

Two widening rules sit on top of the keyword pass, both learned from real
failures:

- **Siblings.** If a request touches a category at all, the rest of that
  category's verbs are offered. Reading a calendar is one sentence away from
  changing it, and categories are small.
- **The lie guard.** If the request asks for an *action* and nothing offered
  can perform one, the creating capabilities are added. This exists because
  "put a reminder … in calender" matched no calendar capability — the word
  is misspelled — and the agent replied *"I can't create calendar reminders,
  so you'll need to add this manually."* It can. No keyword list fixes a
  typo; noticing the shape of the request does.

**An ambiguous request widens the set rather than narrowing it** — it offers
everything within the mode's cap, which is exactly what the system did before.
Routing can only ever lose tokens, never capabilities.

`IntentRouterService` adds one escalation: when the keyword pass is ambiguous
*and* the mode is not Light, it spends one small model call (temperature 0,
256 output tokens) asking for a JSON array of capability names, validated
against the eligible set. Always-on capabilities survive whatever it says. Any
failure — bad JSON, a model error, an unknown name — falls back to the keyword
selection. `ASSISTANT_ROUTER_MODEL` can point this at a cheaper model; blank
means the turn's own model.

Routing happens strictly *inside* the user's eligible set. Grants were
resolved before it ran, so no routing decision can widen permissions.

---

## 5. Effort modes

`assistant_settings.effort_mode`, overridable per message
(`POST /assistant/messages { content, mode }`). An override never persists.

| | Light | Default | Deep |
|---|---|---|---|
| tool steps | 3 | 6 | 12 |
| capabilities offered | 6 | 14 | 32 |
| plan | — | yes | yes |
| verify | — | yes | yes |
| parallel reads | 3 | 4 | 4 |
| semantic facts | 6 | 20 | 40 |
| episodes | 0 | 3 | 6 |
| threads | 2 | 5 | 8 |
| tool result chars | 4 000 | 20 000 | 20 000 |
| max output tokens | 1 024 | 4 096 | 8 192 |
| search results | 3 | 5 | 8 |
| pages fetched | 0 | 2 | 5 |

Every row is live: `searchResults` and `fetchPages` are read by `web_search`,
so Light searches narrowly and reads nothing, while Deep reads several pages. The budget also drives how much memory is *loaded* —
`memoryContext(user, budget)` passes the fact limit into `liveFacts()` and the
episode/thread limits into their queries, so Light does less database work as
well as less model work.

`budgetFor()` falls back to Default for anything unrecognised, so a bad value
in the database cannot break a turn.

---

## 6. Planning

Planning costs a model round trip, so it is not automatic.
`plan-trigger.ts` decides, purely:

| Reason | Plans? | When |
|---|---|---|
| `budget` | no | Light mode |
| `multi_clause` | yes | more than one action clause (split on `and`, `then`, `also`, `;` …) |
| `multi_category` | yes | the selected capabilities span more than one category (ignoring `time`) |
| `mutating` | yes | one category, but something will change the user's data |
| `single_task` | no | one read in one category |

The planner then returns, at temperature 0 and ≤700 output tokens:

```json
{"intent":"…","steps":[{"id":"s1","goal":"…","capability":"list_events","depends_on":[]}],"clarification":null}
```

> ⚠️ The planner's token ceiling is **2 500** and it asks for
> `reasoning_effort: 'low'`. That is not generosity: the default model's
> reasoning is spent from the same allowance, and at 700 its JSON arrived
> truncated mid-sentence on every call, with no error. See `AI_SYSTEM.md` §3.

`PlannerService.parse` (pure, directly tested) extracts the first `{…}`,
validates it with zod, then **drops any step naming a capability that was not
offered** — a step that cannot be executed cannot be verified, and carrying it
would mean promising something impossible. It de-duplicates step ids, prunes
dependencies pointing at dropped steps, and caps the step count at the mode's
tool-step budget. Anything else returns `null` and the turn proceeds unplanned.

A plan is **the agenda, not an execution script.** The model still decides the
actual order and arguments. The agenda's job is to survive the turn so
verification has something to check.

---

## 7. Execution

`ExecutionService.run()` is the old loop with two changes.

**Parallel reads.** When *every* tool call in one model step is `read` tier,
they run together, `budget.parallelism` at a time. The moment a `write` or
`outward` call is in the batch, the whole batch runs sequentially in the order
the model emitted it — a read after a write is often *checking* that write, and
reordering it would make verification lie. The tier comes from the skill
definition, so this cannot be talked into parallelising a write.

**Honest exhaustion.** Running out of steps used to produce a silent no-tools
generation. Now the final pass is told it ran out and instructed to say what is
still outstanding.

Unchanged: skills never throw into the loop, every failure becomes a readable
error result plus a receipt, and tool results are truncated by character count
(now `budget.toolResultChars`, not a hardcoded 20 000).

---

## 8. Verification

`verification.ts` (pure). Each plan step is matched against the turn's
receipts — **never against the model's account of itself**:

| Receipt status | Step status |
|---|---|
| `success` | `verified` |
| `needs_approval` | `queued` — parked for approval, *not done* |
| `failed` / `denied` | `failed` |
| no receipt at all | `not_attempted` |

Receipts are **consumed** as they match, so two steps on the same capability
need two successful invocations: one success cannot vouch for both. Where a
capability both failed and succeeded (a retry), the success wins.

`verificationNote()` renders the verdict as `DONE: / WAITING ON THEM: /
FAILED: / NOT DONE:` lines plus the instruction *"Claim only what is marked
DONE. Say plainly what FAILED or is NOT DONE."* That note is appended to the
history and the model writes its reply against it.

**The extra round trip is only spent when it is needed.** If every step is
verified or queued, the model's own text already stands and no final pass
happens. The closing call costs a round trip exactly when the turn went wrong —
which is when honesty is worth paying for. If that closing call fails, the
loop's own text is returned rather than failing the turn.

The receipt rule ("never claim an action happened without a tool result") was
previously prompt-plus-audit-trail. It is now prompt, audit trail, *and* a
mechanical check.

---

## 9. What is persisted

Migration `0012_agent_core.sql` — **apply by hand in the Supabase SQL editor.**

- **`agent_plans`** — one row per planned turn: `request`, `intent`, `mode`,
  `status` (`running|completed|partial|failed`), `step_count`, and `routing`
  (`{capabilities, ambiguous, viaModel}`) so a turn's tool list can be
  explained after the fact.
- **`agent_plan_steps`** — one row per step with its final `status` and the
  `invocation_id` that settled it. Unique on `(plan_id, step_key)`.
- **`assistant_settings.effort_mode`** — `light|default|deep`, default
  `default`, check-constrained.

Both tables are owner-only RLS (`enable` + `force`, four policies), written
through the **user's** RLS-scoped client — a plan is the user's data, not
system telemetry. Every write swallows its own failure: an unrecorded plan must
never cost the user their answer. Until the migration is applied, plans simply
do not persist and `effort_mode` reads as undefined → Default.

Read them back at `GET /assistant/plans?limit=`.

---

## 10. HTTP surface changes

| Method | Path | Change |
|---|---|---|
| POST | `/assistant/messages` | accepts optional `mode: light\|default\|deep`; response gains an additive `agent` object (`mode`, `capabilities`, `model_calls`, `plan` with per-step status). `message` and `receipts` are unchanged |
| PATCH | `/assistant/settings` | accepts `effort_mode` |
| GET | `/assistant/capabilities` | **new** — the registry readout: every capability this user may use, plus the effort modes and the active budget |
| GET | `/assistant/plans?limit=` | **new** — recent plans with each step's verified outcome |

No existing field changed shape or meaning, so the web app and Android app
keep working untouched.

---

## 11. The friend half

`PulseService` already decided *whether* to speak (urgency × value × novelty,
cooldowns, a daily budget of 3, everything logged to `interventions`). Two
changes here:

- **It now knows who it is talking to.** `compose()` injects up to 8 surviving
  semantic facts (through the same `memory/decay.ts` selection the chat uses,
  so a faded fact does not reappear in a push notification), the newest
  narrative snapshot (600 chars) and up to 3 active attention threads, with
  the instruction to *use* what it knows rather than recite it. Still **no
  tools are offered on this call** — the injection posture is unchanged — and
  any model failure still falls through to the hardcoded `plain()` sentence.
- **The daily budget resets on the user's day.** `sentToday()` counted from
  UTC midnight, so in IST the three-message budget rolled over at 05:30 local:
  three in the morning, three more the same evening. `pulse/local-day.ts`
  derives local midnight from the wall clock (no offset table) and falls back
  to UTC for an unknown zone.

---

## 12. Cost

Per turn, in model round trips:

| Turn | Router | Planner | Loop | Final | Total |
|---|---|---|---|---|---|
| Light, anything | 0 | 0 | 1–3 | 0 | **1–3** |
| Default, clear single read | 0 | 0 | 1–2 | 0 | **1–2** |
| Default, multi-task, all succeeded | 0 | 1 | 2–4 | 0 | **3–5** |
| Default, multi-task, something failed | 0 | 1 | 2–6 | 1 | **4–8** |
| Default, vague request | 1 | 1 | … | … | +1 |

Against that, every call in a routed turn carries 6–14 tool schemas instead of
28. `ASSISTANT_ROUTER_MODEL` and `ASSISTANT_PLANNER_MODEL` exist so the two
classification-shaped calls can run on a smaller model; both blank means no
behaviour change.

Still true, and still the biggest known gap: **nothing counts tokens.** There
is no tokenizer anywhere, so budgets are expressed in messages, characters and
steps. Output tokens are now capped per call (`maxTokens` on `LlmService`), but
input is not measured.

---

## 13. Invariants

In addition to `docs/AI_SYSTEM.md` §19:

1. **The executable registry stays the source of truth.** Routing metadata may
   describe a skill; it may never define one.
2. **Routing narrows, never widens.** Grants are resolved before routing runs.
3. **Only `read` capabilities may run in parallel.** The tier comes from the
   skill definition, never from the model or the plan.
4. **Verification reads receipts, not prose.** If you add a path that can
   satisfy a step without writing a receipt, verification is wrong from then on.
5. **Every stage degrades.** Router, planner, plan persistence and the final
   pass each have a failure path that still answers the user.
6. **New skill → new metadata entry**, or the registry test fails.
7. **No magic numbers outside `effort.ts`.** A new limit belongs in the budget.
