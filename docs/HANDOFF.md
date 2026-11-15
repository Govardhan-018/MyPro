# MyPro — Session Handoff

What the last session changed. `docs/PHASES.md` is the durable plan; this file
is volatile. Read `AGENTS.md` too.

## This session: Phases 6, 7, 8, 10 and 11 — the clock moved off render

The brief was "finish all the pending phases up to 11". Phases 6, 7, 8, 10
and 11 are now code-complete, so **everything up to and including Phase 11 is
done** and Phase 12 is next. All four packages pass `npx tsc --noEmit` and the
web build succeeds.

### Migrations must be applied by hand

A commit does not run them. In the Supabase dashboard:

- `supabase/migrations/0008_pending_action_result.sql` — adds
  `pending_actions.result`. Without it, **approving an outward action throws**:
  the approve route writes that column.
- Earlier ones still pending from previous sessions: `0005`, `0006`, `0007`.

### Phase 11 — the clock (done)

The drain loop left render, where the free tier's 15-minute sleep was killing
it silently, and now lives on the laptop and the phone.

- **11.1** `backend-local/src/scheduler/` — the drain loop, on boot and every
  minute. Two deliberate differences from render's version: no deferring (the
  model is in-process, so a failed generation falls straight through to the
  plain brief), and a **staleness rule** — a *recurring* job more than
  `SCHEDULER_STALE_MINUTES` (default 120) late is skipped to its next
  occurrence, because "here is your day" at 11pm is not a morning brief.
  One-shots always fire; late beats never.
- `backend-local/src/schedules/recurrence.ts` is a **deliberate copy** of
  render's. The backends are separate npm projects (only `shared/`,
  `frontend/`, `android/` are workspace members). Change one, change both.
- **11.2** `android/src/lib/notifications.ts` arms local notifications for the
  next 48h and re-arms on every foreground. Occurrences come from a new
  `GET /schedules/upcoming?hours=48` (render expands them with
  `expandOccurrences`), so luxon and the recurrence maths stay off the phone.
- **11.3** `android/src/lib/brief.ts` composes the plain brief from calendar +
  tasks. It looks for the generated brief in **`/notifications`**, not the
  chat: the chat lives behind the laptop, which is the machine that may be
  asleep. Today's screen says which version you are reading.
- **11.4** Render's `SchedulerModule` is inert unless `SCHEDULER_ENABLED=true`
  (default **false**, pinned in `render.yaml`). It logs which half owns the
  clock at boot. Never run both.
- **11.5** The `TODO(channels)` fan-out moved with the loop →
  `backend-local/src/notifications/push.service.ts`.

### Phase 6 — notifications (done)

- **6.2** Web Push. `frontend/public/sw.js` (push + notificationclick only —
  not a caching worker, deliberately), `frontend/src/lib/usePush.ts`, and a
  real control in Settings → Notifications. The VAPID **public** key is served
  by `GET /me/push` so nothing is bundled; the **private** key lives only in
  `backend-local/.env`, since the laptop is the half that sends.
- **6.4** `PushService` fans out from `device_tokens`, honours
  `notification_channels`, and deletes dead subscriptions (410/404,
  `DeviceNotRegistered`). Android goes through **Expo's** push gateway, which
  needs no server key — a raw FCM token is refused, because FCM v1 needs a
  service-account JWT this project chose not to carry.
- New: `POST /devices/unregister { token }` — a browser that unsubscribes
  knows its subscription but not the row id, and `GET /devices` does not
  return tokens.

### Phase 7 — Gmail (code done; needs your Google Cloud work)

Render owns all of it, because it is the only half holding
`TOKEN_ENCRYPTION_KEY`.

- `common/crypto.service.ts` — AES-256-GCM. Note tokens are stored as Postgres
  **bytea hex literals** (`\x…`); writing base64 there stores the characters
  of the encoding and decrypts to nothing.
- `gmail/google-oauth.service.ts` — consent URL with an **HMAC-signed,
  10-minute `state`** carrying the user id. The callback arrives from Google
  with no session, so that signature is the whole CSRF defence.
- `gmail/gmail-api.service.ts` — list/get/history/send. `format=metadata`
  only: **message bodies are never stored**. Headers are stripped of CR/LF
  before sending (header injection).
- `gmail/gmail-sync.service.ts` — backfill, then incremental by `historyId`;
  a 404 on history means the cursor expired, so it backfills instead.
- **7.5** `backend-local/src/gmail/email-insights.service.ts` — summaries on a
  10-minute tick, on the laptop, where the model is. Email content is fenced
  and declared as data; no tools are offered on that call.
- **7.6** `send_email` really sends. The laptop calls
  `POST /internal/gmail/send` (shared-secret guard) rather than holding a
  Gmail token. `skills.module.ts` re-validates the parked args, marks the row
  approved *before* sending, then writes the outcome to `pending_actions.result`.
- Settings → **Mail**: connect, connect another, sync now, disconnect.

⚠️ **The 7-day trap is real and unavoidable from code.** An OAuth app left in
*Testing* issues refresh tokens that expire weekly. Start Google's
verification review for `gmail.readonly` early. Needs on render:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
(…/api/v1/gmail/callback), `APP_URL`; and `RENDER_API_URL` on the laptop.

### Phase 8 — Android (done)

- **8.3** Today, Assistant chat, Calendar, Health (read-only), My Knowledge,
  More — plus `components/TabBar.tsx`. **No react-navigation**: the web app
  already drives sections from one `view` state and this mirrors it.
  `CalendarScreen` keys days by the **local** date, not `toISOString()` — the
  bug that drew web events on the wrong day.
- **8.4** Expo push token → `device_tokens`. Needs `extra.eas.projectId` and a
  Firebase `google-services.json`; without them it reports a reason and the
  clock carries on regardless.
- **8.5** Reader touch: swipe to turn (PanResponder, claims only clearly
  sideways drags so vertical scroll still works), long-press to
  highlight/note, tap a marked paragraph to see or remove it, star to bookmark,
  one `reading_sessions` row per sitting. Uses the web's anchoring model
  unchanged — page + paragraph index + `anchor_text`.
- Sign-out moved from Library to More.

## Phase 10.4 — OCR for scanned PDFs (done)

A PDF with no text layer is now read on the device that holds it.

- `shared/src/pdf.ts` — the seam: `PdfPageImage`, `PdfOcr`,
  `PdfHandle.renderPage?`, `PdfTextSourceOptions.ocr?`, status `'ocr'`, and
  `PdfPage.ocr` / `PdfTextDoc.ocr` so nothing downstream mistakes machine-read
  text for the real thing. `runOcr()` goes front to back, persists every four
  pages so a closed tab resumes rather than restarting, yields between pages,
  and falls back to `scanned` if recognition finds nothing either.
  `ocrParagraphs()` shapes OCR lines into paragraphs on blank lines and
  stitches hyphenated line breaks.
- `frontend/src/lib/pdfOcr.ts` — Tesseract (WebAssembly) in a worker, one
  worker per book, lazily imported so it costs nothing for the sessions that
  never open a scan. The worker script is served from our own origin via a
  Vite `?url` import, so **no third-party URL is written down in this repo**;
  the core WASM and language data fall back to the library's own defaults
  unless `VITE_OCR_CORE_PATH` / `VITE_OCR_LANG_PATH` are set.
  `VITE_OCR_LANGUAGE` defaults to `eng`.
- `frontend/src/lib/pdfEngine.ts` — `renderPage()`, the only place this module
  draws anything. OffscreenCanvas where available, white fill under the page
  (a transparent canvas gives Tesseract black text on nothing), PNG not JPEG
  because JPEG ringing around glyph edges measurably costs accuracy.
- The reader reports progress: "Reading the scan · 12/240", and says which
  page is still to come rather than looking stuck. `'ocr'` is styled as
  progress, not a warning.

**Why on-device.** Sending page images to a cloud OCR service would quietly
break the "PDFs never leave the device" promise for exactly the most private
documents — the scans — and would cost money per page. Android gets no
implementation: it has no renderer, so a scan there still reports `scanned`
and says to open it once on the web.
## What's next (in order)

1. **Phase 12 — ground under the agent.** 21 skills, still **zero tests**, and
   Phase 7 just added a path that sends real email to real people. Start with
   the pure logic that has already bitten: `computeNextRun`, `groupBlocks`,
   `dateKeyOf`, plus the new `expandOccurrences` and `ocrParagraphs`.
2. **Phase 13.2** — an offline cache on the phone. Its screens are done; the
   library list, calendar, brief and chat are still network-only.
3. **Phase 18.2 — the theme tokens.** `--graphite`, `--medium`, `--soft`,
   `--accent`, `--deep` and `--secondary` are all `#ffffff`, used ~97 times.
   That one decision has now caused four invisible-element bugs, and it is why
   the new reader highlight uses `rgba(255,255,255,.12)` rather than a fill.
4. **Phase 16** — commitments and the Pulse, the phase that changes how it
   feels.

## Not verified

**Typecheck and build only.** `npx tsc --noEmit` passes in all four packages
and `pnpm --dir frontend build` succeeds (the Tesseract worker is emitted as
its own 111 KB asset; `dist/` was deleted afterwards).

Nothing signed-in was exercised, because a sandbox cannot:

- No notification has been armed on a real phone, and no local notification
  has fired.
- No mailbox has been connected, so no OAuth round trip, sync, insight or send
  has ever run.
- No push has been delivered to a closed browser.
- No brief has been generated by the moved drain loop.
- No scanned PDF has been put through OCR.
- The Android screens have **never been run** — there is no build here for
  them, only `tsc`.
## Still true from earlier sessions

- Web: `https://mypro-by-gova.vercel.app` · Render:
  `https://mypro-km2k.onrender.com` (base `/api/v1`) · Supabase ref
  `kssucdvrfzbdkyzovmjo`.
- Auth is **brokered by Render**; clients hold no Supabase credentials except
  the publishable key served at runtime by `GET /me/realtime`.
- Both auth guards derive JWKS from `SUPABASE_URL`; `SUPABASE_JWKS_URL` is
  unused.
- `performSupabaseUpload` in `utils/pdfStorage.ts` is **still a fake progress
  simulator** — only extracted JSON really syncs, never the raw PDF.
- pdfjs runs without CMaps, so CJK PDFs may extract poorly.
- Images are Git LFS, except `frontend/public/*.png`, exempted because Vercel
  does not fetch LFS objects and served the logo as a 130-byte pointer.
- A test item "API Test Book" sits in the real library; Library has no delete UI.
- Commit only when asked. Co-author line:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
