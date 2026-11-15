# MyPro — Session Handoff

Context for continuing in a new chat. Read `AGENTS.md` and `docs/ROADMAP.md` too,
but **this file overrides the original architecture where they differ** (the
auth model changed this session).

## Where we are

Roadmap Phases 1–5 are essentially done, plus a thin-client re-architecture.
**Everything is deployed and login works with real data (verified live):**

- Web: Vercel — `https://mypro-by-gova.vercel.app`
- Core API: Render — `https://mypro-km2k.onrender.com` (base `/api/v1`)
- Supabase project ref: `kssucdvrfzbdkyzovmjo`
- Android: release APK built by GitHub Actions on push (installs standalone)

## ⚠️ Uncommitted right now — commit first

**PDF → text (Phase 10) is committed** as `0a296f1 PDF to JSON extractor`.
Two things it needs that a commit cannot do:
`supabase/migrations/0005_pdf_text_storage.sql` **must be applied to Supabase**
before the sync half works (extraction and reading work without it; uploads just
fail silently), and the Android deps include
`expo-file-system@~18.0.12` — SDK 52's version, do not let it float to 58.

Uncommitted: **Schedules + live notifications (Phases 5 / 6.1)**

- `shared/src/realtime.ts` (new) — the Realtime notifications stream, shared with
  Android; `api.profile.realtime()` in `shared/src/api.ts`; `description` added
  to `ScheduleRow`.
- `backend-render/src/profile/profile.module.ts` — `GET /me/realtime`.
- `supabase/migrations/0006_realtime_notifications.sql` (new) — **also needs
  applying**; without it the socket connects and never delivers anything.
- Web: `lib/useSchedules.ts`, `lib/useNotifications.ts`,
  `components/schedules/SchedulesView.tsx`, `components/NotificationToasts.tsx`
  (all new), plus `App.tsx` (Schedules view + sidebar bell) and `index.css`.

`tsc` passes in frontend/android/backend-render; the web build passes. The
Schedules view and the toasts were rendered and checked in a browser (empty
state, the full builder, weekday pills, toasts). Nothing signed-in was tested:
no live schedule was created, and no Realtime message has actually been
delivered end to end.

## Key architecture decisions made this session (differ from the original docs)

1. **Shared core** — `shared/` workspace package (`@mypro/shared`): platform-injected
   types, API client, auth, agent discovery. Web + Android both import it.
   pnpm workspace with the **hoisted** linker (`.npmrc`).

2. **Thin client (big change from AGENTS.md)** — the client configures **only the
   Render URL**. Auth is **brokered by Render**: `backend-render/src/auth/auth.module.ts`
   exposes `POST /auth/signup|login|refresh`; the client holds **no Supabase
   credentials**. `shared/src/auth.ts` stores the session and refreshes via Render.
   Web needs only `VITE_API_URL`; Android only `EXPO_PUBLIC_API_URL`.
   `VITE_SUPABASE_*` are now unused.
   - **Social sign-in (Google/Apple) is NOT wired** in the thin-client model yet —
     email/password only.

3. **JWKS 401 fix** — both backends' auth guards now **derive the JWKS URL from
   `SUPABASE_URL`** instead of the separate `SUPABASE_JWKS_URL` env (which pointed at
   the wrong place and 401'd every token). `SUPABASE_JWKS_URL` is now optional/unused.

4. **Android** — Expo SDK 52 app in `android/`; `.github/workflows/android.yml` builds a
   **release** APK (bundles JS, runs standalone) with `lfs: true` (icon is Git LFS).
   Android was a thin scaffold; it now has email/password sign-in, a book list and
   the reader (Phase 10.3). The remaining screens are Phase 8. React 18 (Android) vs React 19
   (web) → `frontend/vite.config.ts` dedupes/pins React to fix a prod `useState` crash.

## Frontend wiring status (`frontend/src/App.tsx` + `frontend/src/lib/*`)

Wired to the API with real data, create/persist, and loading/error states:

- **Library** — `useLibrary.ts` + `libraryMap.ts`
- **Reader annotations** — `readerSync.ts` (highlights/notes/bookmarks + reading sessions)
- **Knowledge** — `useKnowledge.ts` (reads `/knowledge`)
- **Health** — `useHealth.ts` (records read/create/edit; no delete/consent UI yet)
- **Calendar** — `useCalendar.ts` (Day/Week/Month + mobile agenda; original grid look,
  real events, create persists, date-driven; grid is 640px tall, 64px/hour from 8 AM)
- **Today** — real date/greeting/agenda + real "Continue learning" library peek
- **Assistant** — chat → backend-local, receipt cards, online/offline, approvals, persona
- **Auth** — Render-brokered sign-in/up, route guard, `/me/activity` heartbeat

**Removed:** the separate Tasks page (Calendar covers it) — per the user.

## How to work in this repo

- Typecheck: `npx tsc --noEmit` in each of `frontend/`, `android/`, `backend-render/`,
  `backend-local/`. Build: `pnpm --dir frontend build` (then `rm -rf frontend/dist`).
- The sandbox **cannot live-test logged-in views** (needs the user's real Supabase login).
  Rely on tsc/build and on preserving markup/CSS classes.
- **Commit only when the user asks.** They deploy by pushing to `main`
  (Vercel + Android CI auto-deploy). Commit co-author line:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- The user values tokens — be concise, avoid broad re-exploration, don't type passwords.

## Gotchas

- Images are Git LFS; any CI touching them needs `lfs: true`.
- `favicon.png` was changed by the user; `vite.config.ts` may still reference `/favicon.png`.
- A test item **"API Test Book"** sits in the user's real library (Library has no delete UI yet).

## PDF → text, as built (Phase 10)

The extracting device is the one holding the file; everyone else reads its JSON.

- Web: `usePdfText` resolves **IndexedDB cache → cloud JSON → extract here**,
  shows the open page first and fills the rest in behind, then caches and
  uploads the finished document. The sample pages are now the fallback for
  items with no PDF only.
- Android: no engine, so it reads the cached/cloud JSON. A book nobody has
  extracted reports `unavailable` and says to open it once in the web app.
- Ingest was broken and is fixed: the Add-book file input used to keep only the
  **filename** and throw the bytes away, and page counts were guessed from file
  size. Both flows now store the blob (keyed by item id, title as the legacy
  fallback) and read the real page count from the PDF.
- `performSupabaseUpload` in `utils/pdfStorage.ts` is **still a fake progress
  simulator** — the "sync file" button does not upload the raw PDF anywhere. Only
  the extracted JSON really syncs.
- Not done: OCR for scanned PDFs (10.4), and pdfjs runs without CMaps, so CJK /
  exotic-encoding PDFs may extract poorly.

## Schedules + live notifications, as built (Phases 5 and 6.1)

- **Schedules** — `frontend/src/components/schedules/SchedulesView.tsx` +
  `lib/useSchedules.ts`, reached from the sidebar ("Schedules"). Builder
  (daily / weekdays / monthly / once / cron), pause-resume, delete with an
  inline confirm, and per-schedule run history from `/schedules/:id/runs`.
  Note the API validates a **whole** schedule on PATCH, so `rowToInput()`
  rebuilds the row before a one-field edit.
- **Notifications** — `shared/src/realtime.ts` opens a Supabase Realtime
  socket on `notifications`; `lib/useNotifications.ts` turns inserts into
  toasts and feeds the sidebar bell (unread count + a live dot). Marking read
  is optimistic and echoes to other devices over the same socket.
- **The one architectural concession:** Realtime needs a Supabase client, so
  `GET /me/realtime` serves the project URL + **publishable** key at runtime.
  Nothing is baked into the bundles and the socket still carries the user's JWT,
  so RLS decides what arrives — but it is a small walk-back of "the client holds
  no Supabase values".
- Fixed in passing: `.type-switch button.active` was white-on-white
  (`--graphite` is `#ffffff`), so the selected segment's label was invisible
  — in the Add-item modal too, not just the new view.
- Still open in Phase 6: Web Push (6.2), FCM (8.4), and the `device_tokens`
  fan-out TODO at `scheduler.service.ts:210`. Realtime only covers an open app.

## What's next (in order)

1. **Phase 6 (the rest)** — real push when the app is closed: Web Push (VAPID)
   and the `device_tokens` fan-out. (Telegram was dropped; the in-app chat is
   the channel.)
2. Polish — Library item delete UI, Health delete + assistant-consent-grant UI.
3. **Phase 7** — Gmail (needs a Google OAuth app).
4. **Phase 8** — the rest of the Android screens. It now has sign-in, a book
   list and a reader; Today, Calendar, Health and the assistant chat are still web-only.
5. **Phase 9** — companion intelligence (commitments, pulse, memory, rhythm).
