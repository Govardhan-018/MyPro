# MyPro — Session Handoff

What the last session changed. `docs/PHASES.md` is the durable plan and
`docs/BACKEND_PLAN.md` is the architecture contract; this file is the volatile
"what just happened". Read `AGENTS.md` too.

## Latest session — five improvements (branch `claude/clever-dirac-7r1fbd`)

Suites: shared 38 · frontend 51 · backend-render 62 · backend-local 337; all
typecheck; web builds. Verified end to end in a browser against a mock API
(390px): every scenario below passed with no page errors. Migration to apply by
hand: **`0023_offline_reading.sql`** (and `0022` if not yet applied).

1. **Knowledge grouped by source** — `lib/knowledgeGroups.ts` (pure, tested):
   groups derived on the fly (nothing stored → nothing to migrate), merged
   across title formats ("Sapiens" = "Sapiens: A Brief History…" unless authors
   differ), entries without a source land in "Unsorted". Grid with search, sort
   (recent / A–Z / size), type filter → group detail with the existing cards.
2. **Mail "not available"** — root cause on the server is missing config (the
   sandbox cannot reach Render to read it): `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET` unset (or no in-app creds / `0021` not applied).
   `/gmail/status` now returns `missing: [...]` and the panel lists exactly
   that plus the Google Cloud steps. Also fixed: a *failed status request*
   (cold Render, offline) used to be shown as "isn't available on this
   server" — it now says it couldn't check, with Retry.
3. **Chat** — `components/assistant/Markdown.tsx`: safe Markdown (React
   elements, no innerHTML; http/mailto links only), tables, nested lists, code
   with Copy. Replies as clean full-width text, your turns as right-aligned
   bubbles (they were on the left), real initials (was hardcoded "AK"), stick-
   to-bottom only when at the bottom + "Latest" button, auto-growing composer,
   typing dots, history no longer re-animates (one timer per message before).
4. **Calendar** — a started/completed event shows a read-only details card
   (when / where / status) with Mark done · Delete · Close; no disabled form.
   State re-evaluates every 30s while open.
5. **Offline reading** — see PHASES 13.2. Also fixed: reader/podcast writes
   were fire-and-forget (lost offline); the SW precache (`Vary: Origin` needed
   `ignoreVary`); books with a PDF had no way to reach the download control
   (now in the row menu, with a progress badge).

**Not verified here:** the live Render env (blocked host), a real Android
device (IndexedDB/SW in the WebView are standard Chromium, but untested on
hardware), real Google OAuth. True background sync with the app *closed*
needs native work (WorkManager); today sync runs on open/resume/reconnect.

## Previous session — reliability audit

Session management, Android notifications, Gmail OAuth UX, the three-mode
scheduler, plus audit fixes. Suites: shared 38 · frontend 14 · backend-render
58 · backend-local 337 (**+45 tests**); all typecheck; the web builds. One
migration to apply by hand: **`0022_scheduler_reliability.sql`**.

### Session
- `shared/src/api.ts` detects 401 centrally → one shared refresh → retry; a
  dead refresh token clears the session and fires `auth.onSessionExpired`
  **once**; later calls short-circuit without network. A transient refresh
  failure is a 503 "could not renew", never a logout.
- `shared/src/auth.ts`: epoch guard (a refresh in flight during sign-out no
  longer resurrects the session); adopts a session another tab already rotated
  (reusing a rotated Supabase refresh token revokes the whole family);
  `signOut` revokes server-side (`POST /auth/logout`).
- Render `/auth/refresh`: 401 only for a dead token, **503** when Supabase is
  unreachable (it used to log everyone out on a Supabase hiccup).
- Web: "Your session expired" on the sign-in page; refresh on resume/online;
  cross-tab `storage` sync; Enter can't double-submit login. Shell clears the
  WebView back stack on sign-out/expiry.

### Notifications (Android shell)
- Re-arm the phone clock the moment a schedule/calendar event changes (web →
  `rearm`), and on background — a reminder set for "in 10 minutes" then
  swiped away never fired before.
- Sign-out/expiry cancels armed reminders, dismisses ours and withdraws the
  push token (another account's reminders stayed on the lock screen for 48h).
  Device tokens now belong to one user (`registerDevice` drops other owners).
  Web push is withdrawn on sign-out too.
- Channels: HIGH importance (heads-up), PRIVATE lock-screen visibility (user's
  privacy setting decides), no DND bypass. Expo push `priority: 'high'` (was
  batched in Doze). `USE_EXACT_ALARM` + boot re-arm permissions.
- No duplicate reminders: the agent skips pushing a "Remind me" to devices
  that armed it (`device_tokens.armed_at`). The phone arms only reminders —
  AI/email schedules notify when actually done.
- Settings → Notifications (in the app) shows real permission/push status, and
  "Allow notifications" / "Open Android settings" for denied permission.
- Push config is build config: `EAS_PROJECT_ID` + `GOOGLE_SERVICES_JSON`
  (`android/app.config.js`; CI writes the secret to a file).

### Gmail
- The redirect URI is **derived server-side** (`PUBLIC_API_URL` or Render's
  `RENDER_EXTERNAL_URL` + `/api/v1/gmail/callback`); users never type it.
  Settings → Mail is just status + "Connect Gmail"; the one-time OAuth app
  setup is under a collapsed "Developer setup" that shows the URI to register.
- From the Android app the consent screen opens in the system browser and
  returns via `mypro://gmail?...` (signed `return_to` in state). Returning
  opens Settings → Mail with the outcome.

### Scheduler (three modes)
- **Remind me / AI message / Email**, mobile-first form, edit/cancel/delete,
  per-row status, run history with results. Email only when a mailbox can send.
- Agent drain loop: **claims a row before acting** (no double execution);
  AI message runs the full agent as the user (`UserSessionBroker`, short-lived
  session, revoked after) and posts to chat + "Done" notification; email is
  AI-written then sent via render; safe retries (2/10/30 min) only when nothing
  outward happened — a send timeout is never retried.
- Fixed: reminders delivered only their name (payload key mismatch);
  `create_schedule` skill fired recurring schedules immediately at creation.

### Audit fixes
- **Data loss:** "Move PDF to cloud" ran a *simulated* upload then deleted the
  local file; "Move to device" stored a dummy blob. Now honest and
  non-destructive (no PDF-file cloud storage exists yet).
- Settings: row-header button styles leaked into every panel button (mobile
  overhang, stray borders). Chat polling pauses while hidden. Non-JSON error
  pages no longer surface as "Unexpected token <".

## Your steps
1. Apply **`0022`** and **`0023`** in the Supabase SQL editor (code degrades without them).
2. Google Cloud → OAuth client → add the redirect URI shown in Settings → Mail
   → Developer setup (normally `https://<render-service>/api/v1/gmail/callback`).
   Existing users must reconnect Gmail as **read & send** for email schedules.
3. ~~Firebase push~~ — **deferred by decision (2026-11).** No Firebase for now.
   Closed-app alerts for "AI task done" / "email sent/failed" are not delivered;
   they appear in-app on next open. Reminders, calendar alerts and the brief
   are unaffected (local alarms). The code is ready if push is added later
   (`EAS_PROJECT_ID` + `GOOGLE_SERVICES_JSON`, see `android/app.config.js`);
   a no-Firebase alternative (UnifiedPush/ntfy, or a ~15-min background check)
   is still an open question.
4. Install the new APK (native changes: notifications, shell bridge, Gmail return).

## Not verified here (needs a device / live services)
Real Android delivery (heads-up, lock screen, Doze, OEM battery killers),
FCM/Expo push, Google consent + real Gmail send, the magic-link session broker
against the live Supabase project, podcast lock-screen controls.

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
