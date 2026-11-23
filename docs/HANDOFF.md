# MyPro — Session Handoff

What the last session changed. `docs/PHASES.md` is the durable plan and
`docs/BACKEND_PLAN.md` is the architecture contract; this file is the volatile
"what just happened". Read `AGENTS.md` too.

## This session (shipped to `main`, four commits)

Six feature areas. Everything typechecks in all four packages, the full test
suites pass (shared 30 · backend-render 43 · frontend 4 · backend-local 314;
**44 new tests this session**), and the web builds. Three migrations must be
applied by hand: **`0019`, `0020`, `0021`**.

### 1. Session durability — the "mobile logs out too quickly" fix
`shared/src/auth.ts`: refresh no longer wipes the session on *any* failure —
only on a real rejection (401/400/403). A network blink or a cold Render at
token-expiry now keeps the session. Added **`refreshMode`** (`'self'` default /
`'follower'`): the native WebView shell client is a `follower`
(`android/src/lib/client.ts`, gated on `shellEnabled()`) so it never rotates the
shared Supabase refresh token out from under the web app — the real cause of the
hourly logout. Threaded `Platform → createClient → createAuth`.
Tests: `shared/src/auth.test.ts`.

### 2. Notifications — native, verifiable, and they open the right thing
- **Calendar reminders now fire.** `/schedules/upcoming` (backend-render) folds
  in calendar events: **1h before + at the start + any custom `event_reminders`**
  (all-day → at-start only). No device change — the phone already arms whatever
  that endpoint returns.
- **Shared mapping** `shared/src/notify.ts`: `notificationChannelFor`,
  `notificationHash` (tap → the exact route, to the calendar event),
  `hashFromDeeplink`, `NOTIFICATION_VIEWS` (one whitelist for web + shell).
- **Android** `lib/notifications.ts`: two channels (`reminders`, `briefs`),
  accent from the theme token; each notification carries a prebuilt `hash`.
  `ShellApp.tsx` opens it (local), or maps a push `deeplink` via
  `hashFromDeeplink`. `backend-local` push routes to the right channel by kind.
- **Web** `App.tsx`: hash router tolerates `#calendar?event=…&at=…`; a tap opens
  that event's day and sheet (`CalendarView focus`).
- **Podcast media bar** `frontend/src/lib/useMediaSession.ts`: OS media controls
  (lock screen / headset keys). Caveat: the audio is a cross-origin YouTube
  iframe, which can own the lock-screen session; the handlers still catch keys.
- **Podcast playback fix**: the shell WebView blocked media by default — added
  `mediaPlaybackRequiresUserAction={false}`, `allowsInlineMediaPlayback`,
  `allowsFullscreenVideo`, so the player actually plays in the app.
- **Test path**: Settings → Notifications (in the shell) has "Send a test
  notification" → `requestShellTestNotification` → `fireTestNotification`, so
  the pipeline is verifiable on a real phone.

### 3. Gmail — access level + credentials in Settings
- **Per-account access**: connect as **read-only** or **read + send**
  (`POST /gmail/connect {mode}`); the send path is **gated on the stored scope**
  (`scopesGrantSend`). Settings shows a chooser + a per-mailbox access tag.
- **OAuth app credentials in the app** (`0021`): paste Client ID / Secret /
  Redirect URI into Settings → Mail instead of setting Render env vars. The
  **client secret is encrypted** (AES-256-GCM, same key as the tokens) and
  **write-only** — never returned; change = delete + re-enter.
  `GoogleCredsService` resolves per user (in-app row first, env fallback) and
  reports the source. `GoogleOAuthService` now takes resolved creds as params
  (connect / callback / refresh). Endpoints: `GET/POST/DELETE /gmail/oauth-config`.
  Tests: `backend-render/test/{gmail-scopes,google-creds}.test.ts`.

### 4. Calendar "Done" + edit lock
- `0020` adds `calendar_events.completed_at`. `POST/DELETE
  /calendar/events/:id/complete`. **Done only on the day, after the start, for a
  12h window** (`completionWindow`); **editing rejected once started**
  (`isEventEditable`) — enforced server-side, mirrored in the modal (inputs +
  Save disabled, "Mark done" only in-window). Completed events are struck
  through across week/day/month. Past events still delete fine.
  Tests: `backend-render/test/{calendar-reminders,event-completion}.test.ts`.

### 5. Supabase retention
`0019_retention.sql`: a daily `pg_cron` job `prune_old_history()` deletes aged
log/history rows and sweeps expired `research_cache`; live content untouched.
(Retention half of Phase 18.1 — see BACKEND_PLAN §3.)

## Your steps (nothing here is automatic)
1. **Apply migrations** in the Supabase SQL editor: `0019`, `0020`, `0021`.
2. **Install the new APK** (GitHub → Actions → "Android APK" → latest run →
   `mypro-apk`) — the podcast fix and the notification test button are native.
3. **Gmail**: create the OAuth app once in Google Cloud Console, then paste its
   credentials into Settings → Mail (or set the `GOOGLE_*` env vars on Render).
   The read/read-&-send chooser appears once credentials are present.
4. **Closed-app push** for ad-hoc assistant messages still needs the EAS project
   id (8.4); calendar/schedule/brief *local* notifications work without it.

## Not done this session (the two remaining asks)
- **Chat interface polish** (make the mobile assistant feel like ChatGPT/Claude).
- **Offline book download** (Phase 13.2) — cache book text + annotations for the
  reader to work with no connection.

## Still true from earlier sessions
- Web `https://mypro-by-gova.vercel.app` · Render `https://mypro-km2k.onrender.com`
  (`/api/v1`) · Supabase ref `kssucdvrfzbdkyzovmjo`.
- The phone is a thin `react-native-webview` shell (Phase 13.10); native screens
  live behind `EXPO_PUBLIC_SHELL=native`, not yet deleted.
- Tests: Vitest — `pnpm --dir shared|frontend test`, `npm test` in each backend.
- Local web build needs pnpm's isolated linker (`pnpm install
  --config.node-linker=isolated`) — the react 18/19 hoist conflict; CI/Vercel
  unaffected.
- Commit only when asked; use the co-author line the session's attribution gives.
