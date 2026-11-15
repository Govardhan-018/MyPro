# MyPro — the zero-cost architecture

**The constraint:** no recurring spend, ever. Everything must sit inside free
tiers permanently, not "until the trial ends".

This document supersedes the hosting assumptions in `docs/BACKEND_PLAN.md`.
The data model, the RLS policies and the thin-client auth model are unchanged
— what changes is *where the always-on duties live*.

---

## 1. The problem, stated honestly

Render's free instance sleeps after about 15 minutes of inactivity. The
scheduler is an in-process `@Cron` inside that instance, so **the clock dies
with the process.** Everything the product is actually for — the morning
brief, reminders, the inactivity nudge — depends on a process that the free
tier does not permit to stay awake.

The obvious workaround is to ping the instance every few minutes to keep it
alive. Reject it, for three reasons:

1. It spends the free instance-hour allowance to buy back the same allowance.
   Running 24/7 consumes essentially the entire monthly grant, leaving no room
   for a second service, a preview deploy, or a bad day.
2. The pinger itself has to live somewhere. GitHub Actions bills a **minimum of
   one minute per run**, so a 10-minute ping is ~4,300 minutes a month — well
   past the free grant on a *private* repo.
3. It is load-bearing fragility: the day the ping fails, the brief silently
   stops, and nothing tells you.

**Paying Render $7/month solves this. Since we are not paying, the answer is
not to need an always-on process at all.**

---

## 2. The principle

> Stop buying "always on" with a process. Three things are already always on
> and already free: **the phone's operating system**, **the laptop when it is
> open**, and **Postgres**. Give each the job it is actually good at.

| Clock / worker | Job | Why it is free, and right |
|---|---|---|
| **The phone's OS** | Fires anything that must arrive *on time* | Android schedules local notifications itself. No server, no push service, works with the app closed and the laptop off. |
| **The laptop** (`backend-local`) | Does the work, including everything needing the model | Your hardware. On wake it drains whatever fell due while it slept. |
| **Postgres** (Supabase) | Holds the truth both of them read | Already the system of record. |

Render becomes what a free instance honestly can be: **a request-driven API
that is allowed to sleep**, woken by the first request. A ~30 second cold
start is fine for a screen you just opened.

### Why not a server-side clock at all

An earlier draft put `pg_cron` + an Edge Function in the middle to guarantee
08:30. It works, but it is a whole tier of infrastructure bought to solve one
problem — *being on time* — that the device in your pocket already solves for
nothing. Dropped.

### The flaw this avoids

"The laptop catches up when it comes online" is correct for most work and
wrong for one category. **A brief that arrives when you open the lid is not a
brief.** The 08:30 report landing at 10:15 is yesterday's news; you have
already started your day. Catch-up is right for syncing, extraction,
summarising and backfill. It is wrong for anything whose value is its timing.

So the split is explicit, and it is the whole design:

| Kind of work | Clock | Examples |
|---|---|---|
| **Must be on time** | The phone's OS | morning brief, reminders, check-ins, the inactivity nudge |
| **Catch-up is fine** | The laptop, on wake | PDF extraction, Gmail backfill, summaries, retention, receipts |

### How the morning brief actually works

1. The app, whenever it is open, syncs upcoming schedules and registers
   **local notifications** for the next ~48 hours.
2. At 08:30 the OS fires it, whatever else is asleep.
3. Tapping it opens the brief. If the laptop was awake overnight it generated
   a real one into Supabase and that is what you read. If it was not, the app
   composes the plain version from the calendar and tasks it already holds —
   the same degrade-to-plain path that exists today, moved to where it can
   still run.
4. When the laptop next wakes, it drains the backlog and the richer brief
   replaces the plain one.

Nothing in that path costs anything, and no part of it requires a machine to
stay awake.

---

## 3. Target architecture

```
   ┌──────────────────────────────┐
   │  Supabase (the truth)        │
   │  schedules · notifications   │
   │  library · health · receipts │
   └───▲───────────────────┬──────┘
       │ reads/writes      │ Realtime + sync
       │                   ▼
   ┌───┴─────────────┐  ┌──────────────────────────────┐
   │ backend-local   │  │  The app (phone / web)       │
   │ THE WORKER      │  │  THE CLOCK                   │
   │                 │  │                              │
   │ on wake:        │  │  • syncs schedules when open │
   │  • drain overdue│  │  • registers local notifs    │
   │  • generate     │  │    for the next 48h          │
   │    with Groq    │  │  • OS fires them on time     │
   │  • write back   │  │  • opens to the brief, or    │
   │                 │  │    composes the plain one    │
   │ key never leaves│  └──────────────────────────────┘
   └─────────────────┘
       ▲
       │ tunnel URL from node_status
   ┌───┴──────────────────────────┐
   │ backend-render (free)        │
   │ CRUD · auth · signed URLs    │
   │ MAY SLEEP                    │
   └──────────────────────────────┘
```

---

## 4. What moves, and what doesn't

| Duty | Today | Proposed | Why |
|---|---|---|---|
| Firing on time | `@Cron` in Render | **The phone's OS**, from locally scheduled notifications | The only surface that is awake at 08:30 for free. |
| Draining what fell due | `@Cron` in Render | **backend-local on wake**, plus a tick while it is awake | `next_run_at` in the past *is* the pending queue. No new concept needed. |
| Recurrence maths | `schedules/recurrence.ts` | The same file, imported by the agent | Pure TypeScript, moves as-is. |
| Briefs needing the model | Render → laptop | The laptop, directly | It is already the only place the key exists. |
| Laptop asleep at the hour | defer ×3, then plain brief | The app composes the plain brief | The degrade philosophy is unchanged — it just runs where it can. |
| CRUD, auth, signed URLs | Render | **unchanged** | Request-driven. Sleeping is acceptable. |

**Nothing about auth, RLS or the data model changes.** The Edge Function uses
the service key server-side and filters by `user_id` explicitly, exactly as
`SchedulerService` does today.

---

## 5. The free-tier budget

Numbers move; **check each against your own dashboard before relying on it.**
What matters is the shape: nothing here grows with time-awake, only with use.

| Resource | Consumed by | Shape of the risk |
|---|---|---|
| Edge Function invocations | 1/min ≈ 43k/month | Comfortable, but don't add a second per-minute function. One tick does everything. |
| Database size | `assistant_messages`, `schedule_runs`, later email bodies | The only thing that grows forever. Needs retention (§7). |
| Storage | Extracted PDF JSON only | Tiny. Raw PDFs never leave the device — already the design. |
| Egress | App traffic, PDF JSON sync | Personal use won't approach it. |
| Render instance-hours | Only while awake | Falls *dramatically* once nothing pings it. This is the point. |
| GitHub Actions minutes | Android APK builds | Free and unlimited on a **public** repo; capped on a private one. Decide deliberately. |
| Vercel Hobby | The web app | Fine. Note Hobby is non-commercial — personal use qualifies. |

---

## 6. The plan, in order

### Phase A — move the clock to the devices

1. **Agent-side drain.** `SchedulerService` is already a clean "find due rows,
   act, advance" loop. Move it into `backend-local` so it runs on boot and on
   an interval while the laptop is awake. It already knows how to degrade when
   something is unreachable.
2. **App-side firing.** In the Android app, sync upcoming occurrences and
   register local notifications (`expo-notifications`) for the next ~48 hours,
   re-arming on every launch. The OS is the clock.
3. **Plain brief in the app.** When the notification opens and no generated
   brief exists yet, compose one from the calendar and tasks already synced.
4. Disable `SchedulerModule` in `backend-render` behind an env flag.
5. **Proof it works:** the brief arrives at 08:30 on a morning when the laptop
   is shut and Render has been asleep all night.

Keep the phone **dumb**: it schedules notifications, it does not try to be a
worker. Android throttles background work aggressively; notifications it
handles for you.

### Phase B — reach a closed app

1. `web-push` is not a dependency anywhere yet. The Edge Function signs VAPID
   itself (Deno has Web Crypto) or imports a Deno push library.
2. Generate VAPID keys; they already have homes in `env.ts`
   (`WEB_PUSH_PUBLIC_KEY` / `_PRIVATE_KEY` / `_SUBJECT`).
3. Service worker in `frontend/public/`, a subscribe button in the Settings →
   Notifications panel (the panel exists and already says this is missing).
4. Store subscriptions in `device_tokens` (`channel_type = 'web_push'`).
5. Fan out in the tick function — the `TODO(channels)` at
   `scheduler.service.ts:210` describes exactly this, and moves with the code.

### Phase C — the phone

Android already has sign-in, the library and the reader. It needs Today, the
assistant chat, and FCM registration writing into the same `device_tokens`
table. Build the APK in GitHub Actions as today.

### Phase D — companion intelligence (Roadmap Phase 9)

Commitments and derived check-ins. This is the phase that changes how the
thing *feels*, and it costs nothing extra: it is rows in Postgres plus the
tick that already exists.

### Clear as you go

- **Commit.** The logo fix is sitting uncommitted while production serves a
  broken image.
- **The theme tokens.** `--graphite`, `--medium`, `--soft`, `--accent`,
  `--deep` and `--secondary` are all `#ffffff`, used ~97 times. That single
  decision has produced three separate invisible-element bugs so far. Replace
  with a graded monochrome scale.
- **Tests on the pure logic** — `groupBlocks`, `computeNextRun`, `dateKeyOf`.
  Every bug found by hand this session lived in exactly those three.

---

## 7. Traps

- **Gmail (Roadmap Phase 7) is not as free as it looks.** A Google Cloud OAuth
  app left in *Testing* issues refresh tokens that expire after **7 days**, so
  the mailbox silently disconnects every week. Avoiding that means publishing
  the app, and `gmail.readonly` is a restricted scope requiring Google's
  verification review. The money is zero; the time is not. Plan Phase 7 around
  that or postpone it.
- **Supabase pauses projects that go quiet** for long enough. A minute tick
  keeps the project permanently active — a pleasant side effect of Phase A.
- **Don't let `assistant_messages` grow forever.** A retention job (same tick)
  trimming conversations and old `schedule_runs` keeps the database inside the
  free size band for years instead of months.
- **Groq's free tier is rate-limited, not unlimited.** The degrade-to-plain-
  brief path already handles a failed generation; make sure a rate-limit error
  takes that path rather than failing the run.
- **The quick tunnel URL changes on every laptop restart.** Already solved by
  `node_status` discovery — the tick function must read it per run, never
  cache it across runs.

---

## 8. What this does not solve

- **The laptop still sleeps.** Anything genuinely needing the LLM at 03:00
  cannot happen. The degrade path makes that acceptable: you get a plain brief
  rather than nothing. Buying always-on intelligence means paying for a GPU
  host, and that is out of scope by definition.
- **Render's cold start stays.** The first screen after a quiet period waits
  ~30 seconds. Tolerable precisely because the clock no longer depends on it.
- **No redundancy.** Free tiers have no SLA. For a personal companion that is
  the right trade; it should be a conscious one.
