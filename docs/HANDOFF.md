# MyPro — Session Handoff

What the last session changed. `docs/PHASES.md` is the durable plan; this file
is volatile. Read `AGENTS.md` too.

## This session: notifications, Gmail access levels, event completion, session durability, retention

Five feature areas, all typechecked (all four packages) and unit-tested; the
frontend builds. Nothing is committed.

### 1. Session durability — the "logs out too quickly" fix
`shared/src/auth.ts`: refresh no longer wipes the session on *any* failure —
only on a real rejection (401/400/403). A network blink or a cold Render at
token-expiry now keeps the session. Added **`refreshMode`** (`'self'` default,
`'follower'`): the native WebView shell client is a `follower`
(`android/src/lib/client.ts`, gated on `shellEnabled()`) so it never rotates
the shared Supabase refresh token out from under the web app — the real cause
of the hourly logout. Threaded through `Platform` → `createClient` → `createAuth`.
Tests: `shared/src/auth.test.ts` (6).

### 2. Notifications — real, native, and they go to the right place
- **Calendar reminders** now fire: `backend-render` `/schedules/upcoming` folds
  in calendar events — **1h before + at start + any custom `event_reminders`**
  (all-day → at-start only). No device change: the phone already arms whatever
  that endpoint returns.
- **Shared mapping** `shared/src/notify.ts`: `notificationChannelFor`,
  `notificationHash` (tap → the exact route, down to the calendar event),
  `hashFromDeeplink`, `NOTIFICATION_VIEWS` (one whitelist, used by web + shell).
- **Android** `lib/notifications.ts`: two channels (`reminders`, `briefs`) with
  the accent colour from `theme.ts` (no literal); each notification carries a
  prebuilt `hash`. `ShellApp.tsx` taps open that hash (local) or map a push
  `deeplink` via `hashFromDeeplink`. `backend-local` push routes to the right
  channel by kind.
- **Web** `App.tsx`: hash router tolerates `#calendar?event=…&at=…`; a deep link
  opens that event's day and its sheet (`CalendarView focus`).
- **Podcast media bar** `frontend/src/lib/useMediaSession.ts`: OS media controls
  for the player. Caveat: the audio is a cross-origin YouTube iframe, which can
  own the lock-screen session; the handlers still catch hardware keys.

### 3. Gmail — per-account access level
`backend-render` connect takes `mode` (`read` | `send`); scopes requested and
**send is gated** on the stored scope (`scopesGrantSend`). `accounts` exposes
`scopes`. Web Settings → Mail: a Read-only / Read-&-send chooser and a per-mailbox
access tag. `gmail_accounts.scopes` already existed — **no migration**. Tests:
`backend-render/test/gmail-scopes.test.ts`.

### 4. Calendar event completion + edit lock
- Migration **`0020_event_completion.sql`** adds `calendar_events.completed_at`.
- `backend-render` calendar: `POST/DELETE /calendar/events/:id/complete`.
  **Done is allowed only on-the-day, after the start, for a 12h window**
  (`completionWindow`); **editing is rejected once started** (`isEventEditable`)
  — enforced server-side, not just UI. Past events still delete/complete fine.
- Web modal: "Mark done" only in-window, inputs/Save disabled once started,
  completed events struck-through across week/day/month. Tests:
  `backend-render/test/event-completion.test.ts`.

### 5. Supabase retention (memory won't grow forever)
Migration **`0019_retention.sql`**: a daily pg_cron job `prune_old_history()`
deletes aged rows from logs/history (audit 365d, schedule_runs 120d,
notifications 180d, skill_invocations 180d, interventions 180d, research_usage
90d, interest_findings 120d, email_messages 365d, assistant_messages 365d) and
sweeps expired `research_cache`. Live content is never touched.

## Your steps (nothing here is automatic)
1. **Apply migrations by hand** in the Supabase SQL editor: `0019_retention.sql`
   and `0020_event_completion.sql`. (pg_cron is already enabled by 0015.)
2. **Gmail live test** still needs the Google OAuth app (Phase 7.1) + env vars.
3. **Closed-app push** for ad-hoc assistant messages still needs the EAS project
   id (8.4); local calendar/schedule/brief notifications work without it.

## Not done this session (the two remaining asks)
- **Chat interface polish** (make the mobile assistant feel like ChatGPT/Claude).
- **Offline book download** (Phase 13.2) — cache book text + annotations so the
  reader works with no connection.

## Still true from earlier sessions
- Web `https://mypro-by-gova.vercel.app` · Render `https://mypro-km2k.onrender.com`
  (`/api/v1`) · Supabase ref `kssucdvrfzbdkyzovmjo`.
- The phone is a thin `react-native-webview` shell (Phase 13.10); native screens
  live behind `EXPO_PUBLIC_SHELL=native`, not yet deleted.
- Tests: Vitest — `pnpm --dir shared|frontend test`, `npm test` in each backend.
- Local web build needs pnpm's isolated linker (react 18/19 hoist conflict);
  CI/Vercel unaffected.
- Commit only when asked; use the co-author line the session's attribution gives.
