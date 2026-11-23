# MyPro — every phase, in one place

**This is the single source of truth for what is built and what is next.**
It replaces `ROADMAP.md` and `SUPER_APP_PHASES.md`, both removed.

Start a new chat with: *"Read `docs/PHASES.md`, then do Phase N."* Everything
needed to pick up cold is in §1–§3.

| Also read | For |
|---|---|
| `AGENTS.md` | How to work in this repo — commands, conventions, rules |
| `docs/BACKEND_PLAN.md` | The architecture contract: schema, RLS, endpoints |
| `docs/ZERO_COST_PLAN.md` | Hosting: why the clock lives on the devices |
| `docs/COMPANION_VISION.md` | What Phase 16 is reaching for |
| `docs/HANDOFF.md` | What the last session changed (volatile; this doc is not) |

---

## 1. The three corners

Everything in this project belongs to exactly one of three deployables. When a
phase below names a corner, this is what it means.

| Corner | Folder | What it is | Runs on | May it sleep? |
|---|---|---|---|---|
| **WEB/APP** | `frontend/`, `android/` | What you look at and touch. React 19 + Vite on the web; Expo on Android. Both import `shared/`. | Vercel · your phone | The phone's OS is the **clock** — it fires scheduled notifications even when everything else is off |
| **RENDER** | `backend-render/` | The always-reachable API: CRUD, auth brokering, signed URLs. NestJS. | Render free tier | **Yes.** Request-driven; it wakes on the first call |
| **LOCAL** | `backend-local/` | The agent: chat, the agent core, 28 skills, the LLM. Holds the only model key. | Your laptop, via a Cloudflare quick tunnel | Yes — it drains whatever fell due when it wakes |

Plus **`supabase/`** — Postgres, Auth, Storage, Realtime. Not a corner; it is
the shared truth all three read and write.

And **`shared/`** (`@mypro/shared`) — types, API client, auth, agent
discovery, PDF text core, Realtime. Imported by web and Android so there is
never a second implementation.

### How they talk

- Web/app calls **RENDER** for everything except `/assistant/*`, which goes
  straight to **LOCAL**.
- **LOCAL**'s address changes on every start. `start-agent.bat` opens a quick
  tunnel and publishes the URL into `node_status`; Render and the web app both
  read it from there. **Never hardcode it.**
- Auth is brokered by Render. Clients hold **no** Supabase credentials — the
  one exception is the publishable key served at runtime by `GET /me/realtime`
  purely to open the notifications socket.

---

## 2. Ground rules

1. **Zero recurring cost.** Every decision must stay inside free tiers
   permanently. This is why the clock lives on the phone and the laptop
   rather than on an always-on server.
2. **Commit only when asked.** The user deploys by pushing to `main` (Vercel
   and the Android APK build auto-deploy).
3. **Secrets live in each deployable's `.env`.** `.env.example` holds
   placeholders only and is committed.
4. **Migrations are not applied by committing them.** Someone must run the SQL
   in the Supabase dashboard. Say so whenever you add one.
5. **Typecheck before claiming done:** `npx tsc --noEmit` in `frontend/`,
   `android/`, `backend-render/`, `backend-local/`. Build: `pnpm --dir
   frontend build`, then delete `frontend/dist`.
6. **A sandbox cannot test signed-in views.** Verify what you can
   (typecheck, build, pure logic in Node, components in isolation) and say
   plainly what you could not.

---

## 3. Status at a glance

| Phase | Goal | Corners | Status |
|---|---|---|---|
| 0 | Lock in what exists | all | ✅ done |
| 1 | Shared core | web/app | ✅ done |
| 2 | Real auth | web/app · render | ✅ done |
| 3 | Wire the web to the API | web/app | ✅ done |
| 4 | Assistant UI | web/app · local | ✅ done |
| 5 | Schedules UI | web/app | ✅ done |
| 6 | Notifications that reach you | all | ✅ done (6.3 dropped) |
| 7 | Gmail | render · local | ✅ code done — needs a Google OAuth app |
| 8 | Android app | web/app | ✅ done (8.4 needs an EAS project) |
| 9 | Companion intelligence | local | ⬜ superseded by 16 |
| 10 | PDF pipeline | web/app · render | ✅ done (OCR on the web) |
| 11 | The clock | web/app · local | ✅ done |
| 12 | Ground under the agent | local | ✅ 12.1–12.4 done (12.2 live-model scoring still manual) |
| 13 | The phone as main surface | web/app | 🟡 shell cutover built; device-proof + delete (ANDROID_UPGRADE §3) + 13.2 left |
| 14 | Everything you read, searchable | all | ⬜ |
| 15 | One operational picture | render · local | 🟡 15.1 done with Phase 7 |
| 16 | A companion that initiates | local | ✅ built (16.1–16.4); live behaviour unproven |
| 17 | The seam | all | ⬜ |
| 18 | Make it last | all | ⬜ |
---

## 4. The phases

### ✅ Phase 0 — Lock in what exists
**Goal:** nothing valuable lives only on one disk, and the three corners can
reach each other in production.
Committed; frontend on Vercel; the Vercel origin in `CORS_ORIGINS`; the tunnel
URL confirmed landing in `node_status.base_url`. Render stays on the free tier
— Phase 11 is the answer to what that costs.

### ✅ Phase 1 — Shared core · *the Android-critical one*
**Goal:** one implementation of types, API client, auth and agent discovery,
imported by both clients, with the platform injected rather than assumed.
`shared/` exists as a pnpm workspace package; web and Android both import it.

### ✅ Phase 2 — Real auth
**Goal:** no app shell without a real session, restored on load, with a
heartbeat the inactivity nudge can use.
Email/password, brokered by Render (`POST /auth/signup|login|refresh`). Route
guard and `/me/activity` heartbeat in place.
**Not done:** social sign-in. It does not exist in the thin-client model yet.

### ✅ Phase 3 — Wire the web to the API
**Goal:** nothing the user creates is lost on refresh.
Library, reader annotations (highlights, notes, bookmarks, sessions),
Knowledge, Calendar, Health, with loading and error states throughout. The
separate Tasks page was removed deliberately — Calendar covers it.

### ✅ Phase 4 — Assistant UI · *the heart of the product*
**Goal:** a conversation that shows its work and refuses to pretend when the
laptop is asleep.
Continuous chat, receipt cards from `skill_invocations`, an online/offline
indicator from `/nodes/status`, persona editor, pending-approvals queue.

### ✅ Phase 5 — Schedules UI
**Goal:** see, build, pause and delete the standing instructions the agent can
already create, and read what each run did.
Builder (daily / weekdays / monthly / once / cron), pause-resume, delete, and
run history from `/schedules/:id/runs`.
*Note:* PATCH validates a **whole** schedule, so `rowToInput()` rebuilds the
row before a one-field edit.

### ✅ Phase 6 — Notifications that actually reach you
**Goal:** when the companion has something to say, it arrives — whether or not
the app is open.
- ✅ **6.1** Supabase Realtime on `notifications` → in-app toasts, the sidebar
  bell, unread counts. Lives in `shared/src/realtime.ts` so Android reuses it.
- ✅ **6.2** Web Push (VAPID). `frontend/public/sw.js` handles `push` and
  `notificationclick` only — deliberately not a caching worker. The **public**
  key is served by `GET /me/push` so nothing is bundled; the **private** key
  lives only in `backend-local/.env`, because the laptop is the half that
  sends. `POST /devices/unregister { token }` lets a browser that has just
  unsubscribed withdraw a row whose id it never knew.
- ❌ **6.3** Telegram — **dropped**. The in-app chat is the channel.
- ✅ **6.4** Fan-out from `device_tokens` →
  `backend-local/src/notifications/push.service.ts`. Honours
  `notification_channels`, and deletes dead subscriptions when a push service
  answers 410/404 or Expo says `DeviceNotRegistered`. Android goes through
  **Expo's** gateway, which needs no server key; a raw FCM token is refused,
  since FCM v1 wants a service-account JWT this project chose not to carry.

**Done when:** a notification written while the app is closed still reaches
you. *(Code complete; never yet delivered to a real closed browser.)*

### ✅ Phase 7 — Gmail *(code complete; needs a Google OAuth app)*
**Goal:** the assistant can read what people actually asked you for, and reply
with your approval.

Render owns all of it, because it is the only half holding
`TOKEN_ENCRYPTION_KEY` — the laptop asks it to send rather than keeping a
second copy of the most dangerous credential in the system.

- ⬜ **7.1** Google Cloud OAuth app + consent screen — **yours to do.** Set
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
  (`…/api/v1/gmail/callback`) and `APP_URL` on render, plus `RENDER_API_URL`
  on the laptop. With none of them set, the Mail panel says "not available"
  instead of offering a button that cannot work.
- ✅ **7.2** Connect flow in Settings → Mail, multiple accounts (the row is
  `unique (user_id, email)`, so a second mailbox is just another row). The
  callback carries an **HMAC-signed, 10-minute `state`**: it arrives from
  Google with no session, so that signature is the whole CSRF defence.
- ✅ **7.3** Tokens encrypted with AES-256-GCM
  (`common/crypto.service.ts`). Stored as Postgres **bytea hex literals**;
  writing base64 there stores the characters of the encoding and decrypts to
  nothing.
- ✅ **7.4** Sync: backfill, then incremental via `historyId`. A 404 on
  history means the cursor aged out, so it backfills instead. Request-driven —
  render is allowed to sleep, so there is no cron here to be killed by it.
  **`format=metadata` only: message bodies are never stored.**
- ✅ **7.5** `email_insights` generated by the agent, on a 10-minute tick on
  the laptop where the model is. Email content is fenced and declared as data,
  and no tools are offered on that call, so a successful injection has nothing
  to reach.
- ✅ **7.6** `send_email` really sends, behind the existing approval gate. The
  laptop calls `POST /internal/gmail/send` (shared-secret guard); the approve
  route re-validates the parked arguments, marks the row approved *before*
  sending, then records the outcome in `pending_actions.result`.

⚠️ **The trap:** an OAuth app left in *Testing* issues refresh tokens that
expire after **7 days** — the mailbox silently disconnects weekly. Escaping
that needs Google's verification review for `gmail.readonly`. Free, but slow.
Start the review early; everything else is built and waiting.

**Done when:** a week passes without reconnecting anything.

### ✅ Phase 8 — Android app
**Goal:** the phone is a first-class client, not a viewer.
- ✅ **8.1** Expo SDK 52 scaffold importing `shared/`
- ✅ **8.2** Auth + session via AsyncStorage
- ✅ **8.3** Core screens — Today, Assistant, Calendar, Health (read-only),
  My Knowledge and More, behind `components/TabBar.tsx`. **No
  react-navigation:** the web app already drives its sections from one `view`
  state and this mirrors it. `CalendarScreen` keys days by the **local** date,
  not `toISOString()` — the bug that drew web events on the wrong day.
- ✅ **8.4** Expo push token → `device_tokens` (`channel_type: 'fcm'`). Needs
  `extra.eas.projectId` in `app.json` and a Firebase `google-services.json`
  for a standalone build; without them it reports a reason and the clock
  carries on regardless, because 11.2 needs none of it.
- ✅ **8.5** Reader touch interactions, using the web anchoring model
  unchanged (page + paragraph index + `anchor_text`): swipe to turn,
  long-press to highlight or note, tap a marked paragraph to see or remove it,
  star to bookmark, one `reading_sessions` row per sitting. The swipe claims
  only clearly sideways drags, so vertical scrolling still belongs to the
  page.
- ✅ **8.6** Release APK built by GitHub Actions on push (`lfs: true` — icons
  were LFS)

Continues as **Phase 13**.
### ⬜ Phase 9 — Companion intelligence
Superseded by **Phase 16**, which says the same thing with the groundwork in
front of it.

### ✅ Phase 10 — PDF pipeline
**Goal:** the reader shows the real book, and the file never leaves the device
it was added on.
- ✅ **10.1** On-device extraction with `pdfjs-dist` (lazy chunk)
- ✅ **10.2** Structured JSON → the `pdf-text` Storage bucket via
  Render-brokered signed URLs; raw PDF stays local
- ✅ **10.3** Reader renders real text, with document structure: headings,
  subheadings, captions, running heads, and the PDF's own metadata
- ✅ **10.4** Processing states (opening / extracting *n*/*N* / reading the
  scan *n*/*N* / unreadable), and **OCR for scanned PDFs**: when a full text
  pass finds nothing anywhere, the web app rasterises each page with pdfjs and
  reads it with Tesseract (WebAssembly, on the device — a scan is never
  uploaded to be read). Front to back, saving every four pages so a closed tab
  resumes. Android has no renderer, so a scan there still reports `scanned`
  and says to open it once on the web.

*Known gap:* pdfjs runs without CMaps, so CJK and exotic-encoding PDFs may
extract poorly. Fixing it means serving `pdfjs-dist/cmaps` as a static asset.

---

### ✅ Phase 11 — The clock
**Goal: the morning brief arrives at 08:30 on a morning when the laptop is
shut and Render has been asleep all night.**

The scheduler used to be an in-process cron inside RENDER, which the free tier
puts to sleep — so the one thing the product is for silently did not happen.
The work moved to the laptop and the *timing* moved to the phone.

- ✅ **11.1** The drain loop lives in `backend-local/src/scheduler/`: on boot,
  and every minute while awake, find schedules whose `next_run_at` has passed,
  run them, advance. Two deliberate changes from render's version:
  - **No deferring.** The model is in-process here, so the only reason a
    generation fails is the model itself, and that falls straight through to
    the plain brief instead of waiting ten minutes three times.
  - **A staleness rule.** Render was always awake, so `next_run_at` never fell
    far behind; the laptop may have been shut for days. A *recurring* job more
    than `SCHEDULER_STALE_MINUTES` (default 120) late is skipped to its next
    occurrence — "here is your day" at 11pm is not a morning brief. One-shots
    always fire: late beats never.
  - `backend-local/src/schedules/recurrence.ts` is a **deliberate copy** of
    render's. The backends are separate npm projects — only `shared/`,
    `frontend/` and `android/` are workspace members — so neither can import
    the other. **Change one, change both.**
- ✅ **11.2** `android/src/lib/notifications.ts` arms local notifications for
  the next 48h and re-arms on every foreground, so a schedule created this
  afternoon reaches the phone before its first occurrence. The moments come
  from `GET /schedules/upcoming?hours=48`, which render expands with
  `expandOccurrences` — the recurrence maths and luxon stay off the device.
  Occurrence ids are `<schedule id>:<instant>`, so a re-arm replaces a
  notification rather than adding a second.
- ✅ **11.3** `android/src/lib/brief.ts` composes the plain brief from the
  calendar and tasks. It looks for the generated one in **`/notifications`**,
  not the chat: the chat lives behind the laptop agent, which is exactly the
  machine that may be asleep, while notifications are on render. Today's
  screen says which version you are reading — a companion that quietly
  substitutes a lesser answer is one you stop trusting.
- ✅ **11.4** Render's `SchedulerModule` is inert unless
  `SCHEDULER_ENABLED=true` (default **false**, pinned in `render.yaml`), and
  logs which half owns the clock at boot. **Never run both** — they race for
  the same rows and double-send.
- ✅ **11.5** Phase 6.4's fan-out moved across with the loop.

Keep the phone **dumb**: it displays, captures and fires notifications. It
does not become a second worker — Android throttles background work.

**Not yet proven.** Nothing here has been exercised on a real phone: no
notification armed, no brief generated by the moved loop.

### ✅ Phase 12 — Ground under the agent
**Goal: you can add a skill and know within a minute whether you broke
anything.** There are 38 skills; all four parts now have tests. The whole
backend-local suite is **314 tests green**, `tsc --noEmit` clean.

**Test runner: Vitest.** One tool across all four packages. Run per package:
`pnpm --dir shared test`, `pnpm --dir frontend test`, and `npm test` in each
of `backend-render/` and `backend-local/`; `test:watch` for the watch loop.
The backends are separate npm projects, so their configs are `.mts` and their
tests live in `test/` (outside `src/`, so they stay out of the Nest build and
`tsc --noEmit`). The shared and frontend tests sit beside their source.

- ✅ **12.1** Skill tests — `run(args, ctx)` takes an injected db, so each skill
  is directly testable. `test/skill-execution.test.ts` injects a fake query
  builder and asserts the **row actually written**: owner stamping, column
  defaults (`add_library_item` → `want`, `remember` → confidence 0.8), derived
  values (`create_commitment`'s halfway check-in), conflict targets
  (`user_id,key`; `user_id,category,entity`), the auto-created notebook a loose
  note lands in, and the de-duplicated weekday rows a weekly schedule writes.
  The older `*-skills.test.ts` files keep covering the schemas and the tiers.
  **Bug found and fixed here:** `search_library` / `search_knowledge` /
  `search_emails` interpolated the raw query into PostgREST's comma-delimited
  `or=(…)` grammar, so a search like "that book, the one (by Cal)" silently
  split into broken fragments and matched nothing — no error, just wrong.
  Now routed through `orIlike`, which double-quotes the pattern. The same bug
  and fix live in backend-render's library list (`common/crud.ts` `orIlike`) —
  change one, change both.
- 🟡 **12.2** Routing evals — `test/routing-eval.test.ts` runs 30+ realistic
  utterances through the **real** `capability.meta.ts` vocabulary and asserts
  each reaches the capability it needs, inside the default 8-slot budget and
  without falling through to the model. This is the free, deterministic guard
  that stops a 37-skill prompt degrading when you add the 38th. **Still manual:**
  the live-model scoring the spec also calls for — it needs a key and a paid
  call, so run it by hand when changing the router prompt.
- ✅ **12.3** Skills whose backing service is unwired must decline clearly,
  not fail. `send_email` really sends now (7.6), and approving any *other*
  outward skill says so plainly rather than reporting a phantom success.
- ✅ **12.4** Unit tests for the pure logic that has already bitten (Nov 2026).
  41 tests, all green:
  - `computeNextRun` — once / daily / weekly / monthly (with the day-31 clamp)
    / cron, and timezone resolution — in **both** backends. The two copies are
    byte-identical, so the laptop suite mirrors render's exactly; this is what
    catches a change that landed in only one half ("change one, change both").
  - `expandOccurrences` (render) — window expansion and the runaway-cron cap.
  - `groupParagraphs`, `groupBlocks`, `ocrParagraphs` (shared) — paragraph
    breaks, heading/caption classification by relative size, hyphen stitching,
    page-furniture drop, OCR blank-line splitting.
  - `dateKeyOf` (frontend) — the local-vs-UTC day bug it was written to fix,
    with `TZ` pinned to `America/New_York` in `frontend/vitest.config.ts` so
    the timed case is deterministic.

### ⬜ Phase 13 — The phone as the main surface
**Goal: leave the laptop shut for a day and lose nothing but freshly generated
prose.** Finishes Phase 8.

As of Nov 2026 the phone carries the web app's design language, typeface and
logo, its reader, and every feature that is not tied to holding the PDF
itself (13.5–13.9 below). **13.2, the offline cache, is the only real work
left in this phase** — which is also the one thing standing between the app
and its own goal, since everything but the reader still needs the network.

Two differences are architecture rather than backlog, and should not be
"fixed": the phone reads reflowed text instead of the PDF, and its Pages tab
is a map of page numbers instead of thumbnails. Both follow from the file
never leaving the device that imported it.

**It still does not look exactly like the web, and four rounds of
hand-matching did not change that.** 8,936 lines of Android UI are maintained
by hand against the web's 17,796 lines of UI and CSS, with only 220 lines
genuinely native — so the two drift by default, and closing the visible gaps
only moves them. **Decided (Nov 2026): the phone becomes a thin native shell
around the web app.** `docs/ANDROID_UPGRADE.md` has the measurement, the
route, and how the shell is made to feel native from one flag and one CSS
block. Two things it calls out: web push must be disabled inside the shell or
every notification arrives twice, and the offline cache stays its own piece —
which is 13.2 below.

**Built (Nov 2026) — the shell cutover, 13.10 below.** The phone now loads the
deployed web app in `react-native-webview` by default; the native screens are
kept behind `EXPO_PUBLIC_SHELL=native` for one release. So the drift above no
longer accrues — there is no second UI to drift from — and **13.2 (offline
cache) is the only feature work left in this phase**, plus two operational
steps in `ANDROID_UPGRADE.md`: prove the shell on a real device, then delete
the native screens.

- ✅ **13.1** Today, Assistant chat, Calendar, Health, Knowledge screens on
  Android, reusing `shared/` — done as 8.3.
- **13.2** A local cache so the app is useful with no connection. **The only
  real work left in this phase.** Extracted book text is already cached; the
  library list, calendar, brief and chat are not.
- ✅ **13.3** Reader touch interactions — done as 8.5.
- ✅ **13.4** Push registration into `device_tokens` — done as 8.4 (still
  needs an EAS project id to produce a token).
- ✅ **13.5** MYPRO 2.0 visual overhaul of the Android app (Nov 2026).
  New design-token system (`src/theme.tsx`: layered near-black surfaces,
  type scale, 8px spacing, optional violet Color Mode persisted on-device)
  and a shared component kit (`src/components/ui.tsx`: cards, chips, sheets,
  toasts, staggered entrance animation honouring reduce-motion). Bottom nav
  is now Today / Calendar / AI (raised centre) / Library / Health with
  Ionicons; the old More tab became a Settings overlay (appearance,
  notifications state, account) with Knowledge and the new Schedules screen
  (pause / resume / delete against `/schedules`) behind it. Calendar gained a
  month grid, day agenda and event create/edit/delete against the existing
  endpoints. The reader gained four themes (dark/dim/sepia/light), text-size
  and line-spacing controls, immersive tap-to-hide chrome, a page slider,
  and Contents / Marks / Notes sheets that jump to pages — same annotation
  anchors as the web, unchanged. One new JS-only dependency:
  `@expo/vector-icons` (already shipped inside `expo`, so the APK pipeline
  is untouched). The reader still renders synced extracted text: original
  PDF rasterisation on the phone would need the file itself, which never
  leaves the importing device by design.
- ✅ **13.6** Sign-in parity and the `/api/v1` trap (Nov 2026). The Android
  sign-in screen now mirrors the web login page — brand bar with the Color
  Mode toggle, the rolling-cubes mark (rebuilt with RN `Animated`, so no
  native Lottie module joins the APK), the welcome copy and its three
  pillars, then the account panel with Apple / Google / email, one live
  feedback line, show-password, and the sign-in ↔ create-account switch.
  Apple and Google call the same shared `signInWithOAuth` the web calls and
  report the same "not available yet" message rather than looking live.
  **The bug it shipped with:** `EXPO_PUBLIC_API_URL` set to the bare Render
  host made every call 404 with NestJS's `Cannot POST /auth/login`, because
  both backends mount under `app.setGlobalPrefix('api/v1')`. `normalizeEnv`
  in `shared/src/env.ts` now appends the prefix when it is missing (and
  leaves a complete URL alone), so the host on its own works for both
  clients. `android/.env.example` documents the app's two variables for the
- ✅ **13.7** The Android app rebuilt in the web app's own visual language,
  and a round of mobile UI bug fixes in both clients (Nov 2026).
  `android/src/theme.tsx` is now a transcription of the browser's phone
  stylesheet rather than a parallel invention: black canvas, `#111111`
  surfaces, `rgba(86,94,103,.45)` hairlines, the five white opacity tiers,
  and `#b69af5` as the one Color Mode accent. `components/ui.tsx` and the
  screens follow the same classes the web uses (`.glass-card`,
  `.page-heading`, `.mobile-agenda-event`, `.mobile-day-strip`,
  `.learning-row`, `.health-stat`, `.mobile-nav-*`), each named in the
  comment beside it. The nav is the web's `MobileNavSheet`: five tabs over a
  grabber that opens a drawer holding all seven sections plus the quick
  actions.
  **API corrections found while porting:** the library list now reads every
  type (book, podcast, article, note) instead of books alone, and uses the
  API's real status vocabulary `in_progress | completed | want | favorite` —
  the phone had been filtering on a `want_to_read` that no row ever carries,
  so "Want to Read" was always empty. Health reads the nested
  `health_symptoms`, `health_medications` and `health_documents` that
  `/health/records` has always embedded.
  **UI bugs fixed in `frontend/src/index.css` (all of them mobile-only):**
  the selected segment of Day/Week/Month was `#000` on a `#111` card and
  therefore invisible; the calendar's actions row used a bare `1fr` track,
  which floors at min-content, so "New" was pushed off the right edge, and a
  `.page-heading .primary-button` descendant rule pinned that same button to
  41px so its label was cut off inside its own pill; the week strip rendered
  seven days into a five-column grid and wrapped; the nav sheet inherited
  `align-items: center` from the older pill-bar rules, which shrank the tab
  row to 191px of a 375px screen and crushed "Calendar" under the assistant
  button; `.view-scroll` reserved 92px for a 96px nav, so the last card sat
  under it; and the three health tiles' numbers fell out of line whenever one
  label wrapped further than the others. In the reader
  (`reading-listening.css` + `MyProDarkReader.tsx`) the dock carried a zoom
  group that did not fit a phone, pushing "of N" onto its own line and the
  zoom buttons off-screen; the zoom group is now hidden there, the scrubber
  takes the room back, and the dock slides away while you read and returns
  when you pause. The Android reader got the same auto-hiding chrome.
  **Toolchain:** `nodeLinker: hoisted` was removed from `pnpm-workspace.yaml`
  — React Native needs react 18.3.1 and the web app needs react 19, and a
  flat tree can only hoist one, so react-dom 19 ended up beside react 18 and
  the web app would not start. CI still reads `node-linker=hoisted` from
  `.npmrc` for the APK. `@babel/runtime` is now an explicit dependency of the
  Android app, which is what lets Metro resolve it under either layout.

- ✅ **13.8** Reader parity, and the typeface (Nov 2026). The phone's
  reader now carries the web reader's controls value for value: both reading
  modes (continuous is a virtualised flow of page panels, paginated keeps the
  swipe), the three background themes (dark / sepia / paper), font size
  14-22, line spacing 1.5 / 1.7 / 1.9 and the three reading widths, all
  persisted; in-book search over the synced text, capped at 120 hits, each
  jumping to its page; Contents, Pages, Marks and Notes, with the five-colour
  highlight palette (`--ann-*`) and all five annotation kinds, filtered,
  sorted and searched as the browser does. Highlight colour round-trips
  through `annotations.color`, which the API has always accepted.
  Pages is a page map rather than thumbnails: there is no PDF on the phone to
  draw them from, which is the same reason the reader shows reflowed text.
  DM Sans is bundled (`@expo-google-fonts/dm-sans`) and resolved per weight
  by `src/components/Typography.tsx`, since React Native has no font
  inheritance; `expo-blur` and `expo-linear-gradient` supply the glass and
  gradients CSS gave the web. `@babel/runtime` is an explicit dependency so
  Metro resolves it under either linker layout, and `android/android/` is
  ignored as prebuild output.

- ✅ **13.9** The last web-only corners, and a fake feature made real
  (Nov 2026).
  **Collections were never real.** `/collections` and `collection_items` have
  been implemented server-side since the library landed, but the web held
  five hard-coded names in local state, so every rename, reorder and new
  shelf was gone on the next reload. Both clients now read and write the real
  rows: `useCollections` on each side, with rename, delete and a drag-reorder
  persisted as `sort_order`, and long-pressing a library row on the phone
  files it onto a shelf.
  **Health records are writable on the phone.** Add and edit cover the
  columns the API actually has — name, status, severity, started/ended,
  doctor, diagnosis, notes — with symptoms as a comma-separated list and one
  medication, each becoming its own row through `addSymptom` / `addMedication`.
  The detail sheet gained Edit and Delete, and the phone now reads the
  `diagnosis` and `consultation_on` it had been dropping.
  **Gmail** is in Settings: status, connected mailboxes with their sync
  state, connect (which opens Google's consent page in the browser, since the
  flow ends on Render where the tokens live), sync now, and disconnect.
  **Storage sync is deliberately not ported.** The web screen moves PDFs
  between device storage and the cloud; this phone holds no PDFs, so Settings
  says how many books have readable synced text and explains where that
  choice is made instead of showing a screen that could do nothing.

  first time.

- 🟡 **13.10** The thin native shell (Nov 2026) — `docs/ANDROID_UPGRADE.md`.
  `android/App.tsx` now chooses the WebView shell (`src/ShellApp.tsx`) by
  default and the legacy native screens (`src/NativeApp.tsx`) only under
  `EXPO_PUBLIC_SHELL=native`. The shell loads `EXPO_PUBLIC_WEB_URL` in
  `react-native-webview`, keeping native exactly the ~220 lines a web page
  cannot do: the Phase 11 clock and push arming (`lib/notifications.ts`), the
  Android back button, notification deep links (driving the web's URL hash),
  and sending external origins (OAuth consent) to the system browser. The
  **session bridge** is the join: the web owns sign-in and posts its session
  out through `frontend/src/lib/shell.ts` (`postToShell`), and the shell adopts
  it with the new `client.auth.setSession()`, so the native clock carries a
  live token without a second login. Presentation is one `.in-shell` CSS block
  and `viewport-fit=cover` set in the shell only (never in `index.html`, which
  documents why); web push is gated off in the shell so notifications do not
  arrive twice. **The rule holds: every shell branch lives in `lib/shell.ts`
  and changes only how it feels, never what the user can do.** Verified:
  typechecks in all four packages, the web builds, the Android JS bundles
  (`react-native-webview` resolves). **Not yet proven on a real phone — and
  until it is, the native screens are not deleted (ANDROID_UPGRADE §3, step 6)
  and 13.2 stays open.**

### ⬜ Phase 14 — Everything you read, searchable
**Goal: ask "what have I read about attention?" and get an answer out of your
own books and episodes.** The extraction is done and the data sits unused.

- **14.1** Full-text search across extracted pages, using the structure
  already captured so results are readable
- **14.2** Podcast transcripts, generated on **LOCAL** with a local Whisper
  build — free, no API, and only needs the laptop awake, which is exactly what
  Phase 11's drain loop is for
- **14.3** Give the agent eyes here: `search_library_text`, `summarize_book`,
  `what_did_i_learn`
- **14.4** Reading and listening stats from the session tables already
  collecting them

### ⬜ Phase 15 — One operational picture
**Goal: the assistant can answer "what do I owe people this week" from real
data.**

- ✅ **15.1** Gmail — all of Phase 7, done
- **15.2** Health delete + the assistant consent-grant UI, so the database's
  consent gate has a face
- **15.3** Calendar, tasks, email and commitments answered together rather
  than screen by screen

### ✅ Phase 16 — A companion that initiates *(built; live behaviour unproven)*
**Goal: it says something useful you did not ask for, and you are glad it
did.** This is `COMPANION_VISION.md`. All four parts are now implemented and
unit-tested; what has not happened is a real run on the live stack (needs
migrations `0009`–`0011` applied and the agent rebuilt — see §6).

- ✅ **16.1 Commitments and threads.** `commitments` (`0009`) — a state machine
  `open|at_risk|done|slipped|abandoned` with `kind`, `due_at`/`confidence`,
  `next_checkin_at`. Render owns the always-on CRUD (`/commitments`); the agent
  has `list`/`create`/`update_commitment`; the web has a **Commitments**
  section. `next_checkin_at` is auto-armed (≈ halfway to the deadline) on
  create/update so the Pulse has something to fire. **Attention threads**
  (`attention_threads`, `0011`) carry the handful of live concerns; the agent
  opens/closes them (`open_thread`/`close_thread`) and active ones are injected
  into every prompt so it can say "about the Friday project —". *(Not built:
  `commitment_evidence` links.)*
- ✅ **16.2 Memory layers.** Semantic facts (`assistant_memory`) injected every
  prompt with **decay** (`memory/decay.ts` — facts unused past a half-life fade
  below a floor and drop out; using one resets its clock), `remember`/`forget`
  skills, the weekly **narrative** (`0010` + `narrativeRefresh`), and
  **episodic** summaries (`memory_episodes`, `0011` + `episodeRefresh`, 6-hourly,
  one sentence per stretch of conversation). All assembled in
  `AssistantService.memoryContext`.
- ✅ **16.3 The Pulse.** `PulseService` (`pulse/`, 30-min cron) gathers candidate
  signals — commitment check-ins, overdue/soon tasks, action-needed email,
  silence, plus the rhythm signals below — scores each **urgency × value ×
  novelty** (`pulse/scoring.ts`), and sends only those that clear a minimum
  score, a per-signal **cooldown**, and a **daily budget of 3**. Every
  candidate, sent or suppressed and why, is written to `interventions` (`0011`)
  — the suppressed log that answers "what did you decide not to tell me today?".
  Novelty decays from when each signal last fired, so repetition self-limits.
- ✅ **16.4 Rhythm and register.** **Register** (`assistant/register.ts`) is
  derived from the situation (health → serious, at-risk → concerned, deadline →
  focus, a win → celebratory, else casual) and injected as one prompt line.
  **Rhythm** is two Pulse signals in the user's local time: an **evening**
  close-out (19:00–22:00) and the **Sunday letter** (Sun 17:00–21:00). *(Catch-up
  collapse on wake is not special-cased beyond the drain loop's staleness rule.)*

### ✅ Phase 21 — A reply you can read *(built; needs migration 0017)*
**Goal: stop answering with a wall of prose.** Asked for cricket news, the
agent replied with one unbroken paragraph containing a team's all-time Test,
ODI and T20 records — every number of it from a tool result, flattened into
a sentence because a sentence was the only output available.

- ✅ **21.1** `agent/display-blocks.ts` builds cards from the turn's tool
  results: sources with links and dates, fixtures with teams and venues,
  forecasts. Built from what the tools returned, **never from the model's
  prose**, so a card cannot cite a source that was never fetched and a
  parse failure cannot cost the reply.
- ✅ **21.2** The model is told what the screen is already showing and to
  give the takeaway instead of repeating it — otherwise the same headlines
  appear twice, once as cards and once paraphrased above them.
- ✅ **21.3** Rendered in the web chat, and persisted on
  `assistant_messages.blocks` (`0017`) so a reload keeps them. Written
  best-effort: without the column the agent still answers.
- ✅ **21.4** Android renders all of it now — through the WebView shell
  (13.10), the phone *is* the web chat, display-blocks included. The native
  chat that would have needed its own renderer no longer exists.

### ⬜ Phase 17 — The seam
**Goal: the corners stop being tabs.** Until here they are excellent
neighbours; this is what makes it one tool.

- **17.1** One place to ask anything, answered across reading, week,
  commitments and mail in a single response
- **17.2** Cross-corner reasoning — what you read informs what it suggests for
  the week; an open commitment pulls the relevant email *and* the relevant
  highlight; health context changes the register, not the content
- **17.3** One search over documents, annotations, transcripts, messages and
  events

### ⬜ Phase 18 — Make it last
- **18.1** Retention and export — trim `assistant_messages` and
  `schedule_runs` on the same drain loop; one-click export of everything
- **18.2** **The theme tokens.** `--graphite`, `--medium`, `--soft`,
  `--accent`, `--deep` and `--secondary` are all `#ffffff`, used ~97 times.
  That single decision has already produced four separate invisible-element
  bugs (calendar events, the segmented control, every progress bar, and the
  selected Day/Week/Month segment, which was `#000` on a `#111` card). Each
  has been patched where it surfaced, and the Android app sidesteps the whole
  thing — `android/src/theme.tsx` is a graded scale, which is what this item
  asks for on the web. The cause is still here: the next one will show up the
  same way, as something that renders but cannot be seen. Replace the tokens
  with a graded monochrome scale.
- **18.3** A documented upgrade path *if* spending ever becomes an option

### ✅ Phase 19 — One request, several tasks, one honest answer *(built; live behaviour unproven)*
**Goal: say "find the fixtures, put them in my calendar and tell me whether I
can train today" and have all three happen — or be told plainly which did
not.** Spec: `docs/AGENT_SPEC.md`. Needs migration `0012` applied.

- ✅ **19.1 Capability registry.** `capabilities/` joins the 28 skills to
  routing metadata (category, request vocabulary, dependencies, version).
  The executable registry stays the source of truth; coverage is enforced by
  `capability-registry.test.ts`, so skill 29 cannot arrive unroutable.
- ✅ **19.2 Intent routing.** A free keyword pass picks the capabilities a
  request needs — 6–14 tool schemas per model call instead of all 28. An
  ambiguous request *widens* rather than guesses, and only then is one small
  model call spent narrowing it (`ASSISTANT_ROUTER_MODEL`).
- ✅ **19.3 Planning and multi-step execution.** Requests that earn it
  (`plan-trigger.ts`: multi-clause, multi-category, or mutating) get an
  agenda, persisted to `agent_plans` / `agent_plan_steps`. Read-tier tool
  calls in one step now run in parallel; a batch containing a write stays
  sequential, deliberately.
- ✅ **19.4 Verification.** Every planned step is reconciled against
  `skill_invocations` — never against the model's account of itself — and the
  verdict (`DONE / WAITING ON THEM / FAILED / NOT DONE`) is handed back before
  the reply is written. The closing round trip is spent only when something
  actually went wrong. `GET /assistant/plans` reads the trail back.
- ✅ **19.5 Effort modes.** `light | default | deep` in
  `assistant_settings.effort_mode`, overridable per message. One table
  (`agent/effort.ts`) holds every budget: tool steps, capabilities offered,
  memory depth, output tokens, tool-result size, research breadth.
- ✅ **19.6 The friend half.** Pulse check-ins now carry what it knows about
  you (decayed facts, the narrative, live threads) instead of persona alone,
  still with no tools offered. The daily budget resets on **your** day, not
  UTC's — in IST it used to roll over at 05:30.
- ✅ **19.7 The web UI.** A **character creator** (name, letter avatar, four
  starting presets, tone, charter) replaced the three unexplained persona
  fields; the chat calls the assistant by its name and shows its initial. The
  **effort dial** is in that panel, with a per-message override in the chat
  header. Each reply carries its **plan card** — the steps, and which ones the
  receipts actually support. Settings show the live **capability and provider
  readout**, read from the agent. *(Android: not done.)*

### ✅ Phase 20 — Internet intelligence *(built; live-tested)*
**Goal: it can answer things that are not already in your database.** Needs
migration `0013` applied. Contract: `docs/RESEARCH_PROVIDERS.md`.

- ✅ **20.1 The provider layer.** Five kinds (search, news, sports, extract,
  weather), eleven providers, env-ordered chains with fallback. Nothing above
  `research/providers/` knows a vendor name, so **adding a free service is one
  file plus a name in an env chain**. With no keys at all every kind still
  answers — Wikipedia, GDELT, TheSportsDB, Open-Meteo.
- ✅ **20.2 Safe fetching.** SSRF guard re-run on every redirect hop with all
  resolved addresses checked, body ceiling enforced while streaming, per-host
  serialisation and minimum gap, robots.txt honoured and cached. No browser
  automation. 39 tests on the guard and the parser alone.
- ✅ **20.3 Extraction and cache.** Cheerio article extraction with publisher
  and publication date validated rather than assumed (a date that is wrong is
  worse than none), Supabase cache keyed by content hash, every provider call
  recorded in `research_usage` for quota and reliability.
- ✅ **20.4 The capabilities.** `web_search` (search + read the top pages in
  one tool step), `news_search`, `fetch_page`, `sports_fixtures`,
  `get_weather` — routed, planned and verified like everything else, with web
  text carried as explicitly untrusted data.
- ✅ **20.5 Strava.** OAuth on **render** — the redirect URI has to be stable
  and the laptop's tunnel is not, and `TOKEN_ENCRYPTION_KEY` lives there.
  Read-only scopes (`activity:read`), tokens encrypted at rest, and the
  rotating refresh token stored on every refresh (the trap that silently
  disconnects Strava a few hours in). The laptop reads through
  `/internal/strava/activities`, as it does for mail. `list_activities`
  returns the sessions plus the totals a model should not be doing by hand.
  Needs a Strava app and three env vars on render.
- ✅ **20.6 Interest monitoring.** `interests` are first-class rows — a
  standing instruction to go and look, as distinct from a remembered fact.
  The Pulse checks the two most overdue per pass, under all its existing
  gates, and `interest_findings` dedupes by fingerprint so the same story
  cannot arrive twice. Per-interest `push | chat | none`, pause and remove,
  from the agent (`follow_interest`) or the web (render CRUD + the Watching
  panel). The importance filter is a free heuristic — no model call per
  headline.
- ✅ **20.8 Staying awake.** Render free sleeps after ~15 min idle, so
  Supabase wakes it: `0015_keepalive.sql` schedules pg_cron to POST
  `/internal/keepalive` every 10 minutes through pg_net, with the shared
  secret read from the Vault. The endpoint writes `node_status` for
  `node='render'` (so the UI can see the core too) and **does no AI work** —
  it is a ping, not a tick. Outcomes land in `service_pings`, settled
  asynchronously, pruned at 14 days. Caveat: free instance hours are finite
  (~750/month), so this keeps exactly one service awake and no more.
- ✅ **20.9 The agent can leave the laptop.** `backend-local` deploys as a
  second Render service (`mypro-agent`) from the same blueprint: health
  check, `.node-version`, a guarded `/internal/keepalive`, and `0016` to
  point the cron at it instead of the core. The trade is explicit — the
  model key and the Web Push private key leave the machine, and pooled free
  hours mean exactly one service stays awake, so the core sleeps.
  Walkthrough: `docs/DEPLOY_AGENT_TO_RENDER.md`.
- ✅ **20.7 Live-tested.** Routing, planning and verification run against the
  real model; weather, search, page extraction, fixtures and RSS news against
  real providers. Four defects found and fixed this way — see the risks below.

---

## 5. Why this order

```
11 clock ✅ ──▶ 13 phone ──▶ 14 read ──┐
   │                                   ├──▶ 17 seam ──▶ 18 last
   └──▶ 12 agent ground ──▶ 15 run ────┤
                             16 companion ─┘
```

- **11 before everything** — a companion that cannot reach you is a database.
  Done: the clock is on the phone and the laptop now.
- **12 before 14–16** — those are mostly new skills, and untested skills
  accumulate silently. This is why 12 came before 13 and 16 even though they
  are more fun: Phase 7 added a code path that sends real email to real people.
  Now done — the skills run under test (12.1), routing is guarded against
  regression (12.2), and the pure logic has its unit tests (12.4).
- **13 before the corners** — build each on the surface you will actually use,
  or you will do the work twice.
- **17 last by necessity** — you cannot connect corners that do not exist.

---

## 6. Standing risks

- **Render free sleeps.** Phase 11 removed the dependency: the clock no longer
  needs it awake. What remains is a ~30s cold start on the first screen after
  a quiet period, and a sync that only runs when something asks for it.
- **The quick-tunnel URL is ephemeral.** Already handled by `node_status`
  discovery — read it per run, never cache across runs.
- **Free research tiers move, and only a live call finds out.** Four defects
  that typechecks and unit tests could never have caught, all found by
  actually calling things:
  1. **The reasoning-token trap.** `gpt-oss-120b` spends `max_tokens` on
     thinking, so the planner's 700-token ceiling truncated its JSON
     mid-sentence on *every* call — silently, with no error. Fixed with
     `reasoning_effort: 'low'` and wider ceilings. Suspect this first if a
     structured-output call starts returning nothing.
  2. **TheSportsDB names national teams by sport.** `searchteams?t=India`
     returns the *football* team; the cricket side is "India Cricket". Asking
     for India's fixtures returned nothing at all until the lookup retried
     with the sport appended.
  3. **Its old `3` key is permanently disabled** (403 with a message saying
     so). The public test key is now `123`.
  4. **GDELT throttles to one request per five seconds** and answers a
     violation with a 429 that takes ten seconds to arrive — which reads as a
     timeout. It is now last in the news chain behind `rss`.
- **A fixed provider still serves its old answer.** The research cache is
  keyed by the question, not the code, so after fixing a provider the stale
  result stands for up to `RESEARCH_CACHE_TTL_MINUTES` (default 3h). Set it
  to `0` while debugging.
- **Get a Guardian key.** Free, instant, ~12,000 calls/day. Without it news
  falls to RSS feeds you nominate, or to GDELT, which is unreliable.
- **Groq model availability shifts** (`llama-3.3-70b-versatile` already
  vanished once). `ASSISTANT_MODEL` is env-configurable for exactly this.
- **Groq's free tier is rate-limited.** The brief degrades to its plain form
  on any model failure, and an email summary simply waits for the next pass.
- **Gmail's 7-day Testing-mode trap.** An unverified OAuth app disconnects the
  mailbox weekly, and the only symptom is mail quietly going stale. No code
  can work around it.
- **The recurrence maths exists twice** — once per backend, because they are
  separate npm projects. Change one, change both.
- **Database size is the only thing that grows forever.** Phase 18.1. Email
  metadata and `email_insights` now grow too, though bodies are never stored.
- **Migrations must be applied by hand** whenever they are added — a commit
  does not run them. `0005`–`0013` are the current set. Phase 19 needs
  `0012_agent_core.sql` (`agent_plans`, `agent_plan_steps`,
  `assistant_settings.effort_mode`); until it is applied the agent core still
  runs, but plans do not persist and the effort mode reads as Default. Phase 20
  needs `0013_research.sql` (`research_cache`, `research_usage`); until it is
  applied research still works, but nothing is cached and no usage is counted,
  which on free tiers is the difference between 200 requests a day being
  plenty and not. Phase 16 needs three:
  `0009_commitments.sql` (commitments), `0010_narrative_memory.sql` (the weekly
  narrative), and `0011_companion.sql` (episodic memory, the Pulse's
  `interventions` ledger, and attention threads). The `remember`/`forget` facts
  use `assistant_memory` from 0001, so those work even before the rest land.
- **Local dev agent connection.** The web app discovers the laptop through
  `node_status`, which is empty with no Cloudflare tunnel, so in `vite dev` a
  blank `VITE_AGENT_URL` now auto-targets `http://localhost:8787/api/v1`
  (`frontend/src/lib/client.ts`, DEV-only). Production builds are unaffected
  and still discover through render.
