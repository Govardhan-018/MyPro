# MyPro — the Companion

A design vision for the assistant in `backend-local`. Nothing here is built yet;
this is the argument for what to build and why, before any code.

---

## 0. The thesis

A chatbot and a companion differ in exactly two ways:

1. **A companion carries state between conversations.** It does not start from
   zero. It knows what you said you'd do, what you're in the middle of, what
   you abandoned, and what you care about this month.
2. **A companion exercises judgement about when to speak.** It decides, on its
   own, that *now* is the moment — or that now is not, and stays quiet.

Everything below is in service of those two properties. The current assistant
has neither: it replays the last N messages and waits to be spoken to. That is
the entire gap.

The good news is the hard infrastructure already exists — a persistent chat, a
persona/charter, a memory table, a scheduler that runs every minute, a
notification pipe, an audit trail, and a split between an always-on node and a
private node that holds the model. The companion is mostly a matter of giving
that machinery the right *concepts*.

---

## 1. Memory that earns the word

Right now "memory" is one flat key/value table. Real memory is layered, and
each layer has a different lifetime and a different job.

| Layer | What it holds | Lifetime | Where it comes from |
|---|---|---|---|
| **Working** | the last N turns | this conversation | `assistant_messages` (exists) |
| **Episodic** | "on 3 Oct you were stuck on the auth refactor" | months | summarised when a conversation goes quiet |
| **Semantic** | "prefers deep work before noon", "sister's name is Anu" | until contradicted | extracted from chat, confirmed by use |
| **Commitment** | "ship the project by Friday" | until resolved | §2 — the important one |
| **Narrative** | a ~300-word "who you are right now" | regenerated weekly | synthesised from all of the above |

The **narrative layer** is the single highest-leverage idea in this document.
Once a week the laptop writes a short third-person sketch of your current
life — what you're building, what's heavy, what you've been reading, what
you've been avoiding — and that sketch is injected into *every* prompt
thereafter. It costs one generation per week and it is the entire difference
between an assistant that has read your database and one that knows you.

Memory should also **decay and get corrected**. Every semantic fact carries
`confidence` and `last_used_at`. Facts that never get used fade out of the
prompt. When you correct it ("no, I dropped that months ago"), the correction
writes back at high confidence. An assistant that can be wrong and updated
feels far more alive than one that is confidently stale.

---

## 2. Open loops — the mechanism behind "it actually follows up"

This is the concept the current system is missing most, and it is what makes
your examples work.

When you say *"I need to finish this project by Friday"*, a task is the wrong
abstraction. A task is a checkbox. What you actually created is a **commitment**:
a thing you told someone you'd do, with a believed deadline, a confidence
level, and a natural follow-up rhythm.

```
commitments(
  id, user_id, title, detail,
  kind,                  -- promise | goal | decision | intention
  due_at, confidence,    -- how sure we are about the deadline
  state,                 -- open | at_risk | done | slipped | abandoned
  source_message_id,     -- the sentence where you said it
  next_checkin_at,
  created_at, resolved_at
)
commitment_evidence(commitment_id, source_type, source_id)  -- calendar, task, email, annotation
```

Check-ins are *derived from the deadline*, not fixed: roughly at 50% of the
time elapsed, at 80%, and the morning of. That produces the moment that makes
the whole product feel real:

> "You said Friday for the project. It's Wednesday evening, there's no time
> blocked for it, and the task hasn't moved since Monday. Want me to take
> tomorrow 9–11 before the standup?"

That is not a reminder. It is noticing, reasoning over three data sources, and
offering a concrete next move. Commitments + evidence links are what make it
possible.

Related, and cheap to add: a **decision log**. When you say "going with
Postgres over Mongo", record it with the reasoning. Six weeks later, when you
wonder why, it can tell you. People forget their own reasoning constantly;
nothing else in your stack captures it.

---

## 3. The Pulse — proactivity with taste

The failure mode of a proactive assistant is that it becomes a nagging
notification machine and you mute it within a week. The fix is to model
restraint explicitly rather than hoping the prompt handles it.

**Signals** are cheap SQL checks that render runs every few minutes: a task
went overdue, an important email is unanswered, a commitment is at risk, a
calendar gap opened before a deadline, a reading streak broke, a health
follow-up came due, you've been quiet for a while, something you mentioned
weeks ago is now relevant.

Each signal becomes a **candidate intervention**, scored:

```
score = urgency × value × novelty
```

- **urgency** — time-sensitivity. Meeting in 30 min = 1.0. "You might enjoy
  this book" = 0.1.
- **value** — does saying this actually change anything you'd do?
- **novelty** — have I raised this recently? Decays hard with repetition, so
  the third mention of the same stale task scores near zero on its own.

Then three gates:

1. **Cooldown** per signal type — never twice in a day.
2. **Daily budget** — at most ~3 unprompted messages. Scarcity creates weight.
3. **Timing model** — learned from `user_activity` and how fast you read
   notifications. It knows you answer at 8am and ignore things at 3pm.

Anything that doesn't clear the bar is not discarded — it's **queued for the
next natural touchpoint** (the morning brief), or allowed to expire. And
critically: record the suppressed ones too.

```
interventions(
  id, user_id, signal_type, payload,
  urgency, value, novelty, score,
  outcome,               -- sent | queued | suppressed | expired
  suppressed_reason,     -- 'budget' | 'cooldown' | 'low_score' | 'bad_timing'
  sent_at, created_at
)
```

Being able to ask *"what did you decide not to tell me today?"* and get a real
answer is both a great trust feature and the best possible debugging surface
for tuning the thing.

**Silence is a valid, recorded output.** That is the sentence that separates
this from every notification system you've ever muted.

---

## 4. Threads of attention

The chat stays one continuous stream — that's right, and you asked for it. But
underneath, the companion should know that your life has a handful of
*live concerns* at any moment: the project due Friday, the book you're 60%
through, the thing with your knee, the job application.

```
attention_threads(id, user_id, title, kind, state, summary,
                  last_touched_at, next_checkin_at)
```

Messages and commitments link to a thread. This buys three things: it can say
"about the Friday project —" and you both know what that means; it can notice
a thread has gone cold; and the morning brief can be organised by *what you're
actually working on* rather than by data type.

---

## 5. Growable intelligence — skills, not features

You will keep adding capabilities. The assistant must discover them, not have
them hardcoded.

```
skills(
  id, name, description,        -- description is what the model selects on
  input_schema jsonb,
  side_effect,                  -- read | write | outward
  requires_grant,               -- e.g. 'health'
  node,                         -- local | render | external
  enabled
)
skill_invocations(id, user_id, skill_id, args, result, status,
                  duration_ms, message_id, created_at)
```

The orchestrator hands the model the *enabled* skills as tools, chosen by
description. Adding a skill is a row plus a handler — the companion's
abilities grow without touching the prompt.

A **planner** sits above this for multi-step work ("prepare a summary of my
pending work" → search tasks, pull commitments, check calendar, synthesise).
The plan and each step are persisted, so a long operation is inspectable and
resumable rather than a black box.

Skills can live on either node — `node: 'render'` skills (pure data lookups)
keep working in a limited way even when the laptop sleeps.

---

## 6. Acting with integrity

Three tiers, enforced in code, not in the prompt:

| Tier | Examples | Behaviour |
|---|---|---|
| **auto** | read calendar, search library, check tasks | just does it |
| **confirm** | create event, reschedule, edit a note | does it, shows a receipt with undo |
| **approve** | send email, anything outward or irreversible | asks first, always |

Every write produces a **receipt** — a `skill_invocation` row the chat renders
as a small card: *"✓ Scheduled 'Deep work' Thu 9–11 · undo"*. The companion
may only claim something happened when a receipt exists. This is already the
rule in the system prompt; making it structural means it cannot drift.

Health stays behind the time-boxed grant that's already in the database.
The companion simply doesn't see health tools in its tool list until you
grant access, so it cannot even be tempted.

---

## 7. Register — one personality, several modes

A charter defines who it is. A **register** defines how it's being right now:

`focus` · `casual` · `serious` · `celebratory` · `concerned`

The register is *derived*, not random — deadline pressure pulls toward focus,
a health event toward serious, a finished goal toward celebratory, a quiet
Sunday toward casual. It's a single hint in the prompt, and it's most of what
makes the thing feel situationally aware rather than monotone.

Just as important, encode the **anti-patterns** explicitly:

- no "Great question!", no "I'd be happy to help"
- no restating what you just said before answering
- no unsolicited encouragement or motivational filler
- no bullet-point lists in casual conversation
- short by default; length must be earned

It should also be willing to **disagree**. "That's a third thing this week and
you haven't finished the first two" is what a friend says. Pure agreeableness
is what makes assistants feel hollow.

---

## 8. The daily rhythm

| When | What | Register |
|---|---|---|
| **Morning** | what actually matters today + one suggested first move | focus |
| **Midday** | only if something material changed | — |
| **Evening** | short close-out, tomorrow's shape, and *one good question* | casual |
| **Sunday** | the weekly letter — what it noticed about your week | reflective |

The **evening question** is a small idea with outsized effect: one genuinely
contextual question a day, drawn from what it observed. Not a journaling
prompt template — something only an entity that watched your week could ask.

The **weekly letter** is the thing that makes you want to open the app. Longer,
slower, slightly different voice: patterns it noticed, what moved, what's been
sitting untouched for three weeks, a question worth sitting with. Most
assistants have no artefact you'd ever want to re-read. This is one.

---

## 9. How this maps onto the two nodes

This is where the architecture you just chose pays off.

**render (always on)** — collects signals, scores candidates cheaply, runs the
clock, and dispatches anything that needs no language. It never calls a model.

**laptop (private, powerful)** — all judgement and all language: what to say,
how to say it, memory synthesis, the narrative refresh, skill planning.

**When the laptop is asleep**, render keeps collecting and queueing candidates.
When the laptop wakes, it **drains the queue, collapses it, and discards what
went stale** — so you get:

> "Morning — while I was off: the deploy finished, and that email from Maya is
> still waiting. The task I was going to nag you about on Tuesday doesn't
> matter now."

*One* message, not twelve. A companion that catches up when it wakes feels
thoughtful; a system that floods you with stale alerts feels broken. This
behaviour falls directly out of the split you designed, which is a good sign
the architecture is right.

---

## 10. The details that make it feel alive

- **It remembers what it promised you.** "I said I'd check the report — here it is."
- **It notices absence.** Things that *stopped* are signals: you haven't opened
  that book in three weeks, you've not logged health since the flu.
- **Callbacks at the right moment.** Something you mentioned six weeks ago,
  surfaced exactly when it becomes relevant. This is the single most uncanny
  "it knows me" moment available, and it's just semantic memory + good retrieval.
- **It can be told to back off**, per thread, and remembers.
- **It states confidence and invites correction** — "I think you're still on
  the auth work, correct me if that's stale."
- **Pre-mortems.** Before a big commitment: "the last two Friday deadlines
  slipped on integration work — want to start there?"
- **It owns mistakes** plainly, without grovelling.

---

## 11. Schema additions, in one place

New tables: `commitments`, `commitment_evidence`, `attention_threads`,
`interventions`, `skills`, `skill_invocations`, `memory_episodes`,
`narrative_snapshots`, `decisions`.

Extend `assistant_memory` with `confidence`, `last_used_at`, `decay_at`.
Extend `assistant_messages` with `thread_id`, `register`, `intervention_id`.

All of it follows the existing conventions — `user_id` on every row,
default-deny RLS, multivalued facts in their own tables.

---

## 12. Build order

Each step is useful on its own, so nothing is wasted if priorities change.

1. **Skills + receipts.** Tool-calling with a registry, three-tier permissions,
   receipt cards. The assistant can *do* things. Biggest single jump in utility.
2. **Commitments + threads.** It starts following up on its own. Biggest jump
   in feeling like a companion.
3. **The Pulse.** Signals, scoring, budget, cooldowns, the suppressed log.
   Proactivity with restraint.
4. **Memory layers.** Episodic summarisation, semantic extraction, the weekly
   narrative refresh. The "it knows me" step.
5. **Rhythm + register.** Morning/evening/Sunday, derived tone, the catch-up
   behaviour when the laptop wakes.
6. **The assistant UI.** Continuous chat with receipts, thread chips, the
   context-window and clear controls, a "what did you suppress?" view.

My instinct is 1 → 2 → 3 is the order that makes it feel transformed fastest;
4 is what makes it feel personal; 5 and 6 are what make it feel finished.

---

## 13. What this is not

Not a voice assistant. Not a productivity enforcer — it should never feel like
a manager with a clipboard. Not a system that needs configuring before it's
useful. And not a thing that talks constantly: the restraint is the product.
