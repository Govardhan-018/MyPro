# MyPro — Session Handoff

What the last session changed. `docs/PHASES.md` is the durable plan; this file
is volatile. Read `AGENTS.md` too.

## This session: the Android WebView shell (Phase 13.10 / ANDROID_UPGRADE)

Executed `docs/ANDROID_UPGRADE.md` through the cutover (route steps 1–5). The
phone is now a thin native shell around the deployed web app: one codebase, one
design, nothing to drift. The native screens are untouched but demoted behind a
flag, not deleted — that waits on a real-device check.

**Typechecks pass in all four packages, the web app builds, and the Android JS
bundles with `react-native-webview` resolving.** What has *not* happened is a
run on a real phone (no sandbox can) — see "Before it ships" below.

### What changed
- **`android/App.tsx`** now chooses: `shellEnabled()` → `src/ShellApp.tsx`
  (default), else the legacy UI, moved verbatim to **`src/NativeApp.tsx`** with
  its font gate + theme/toast providers kept in `App.tsx`.
- **`android/src/ShellApp.tsx`** (new) — a `react-native-webview` onto
  `EXPO_PUBLIC_WEB_URL`. Native-only concerns: adopts the web-posted session
  (`client.auth.setSession`) and arms the clock + push; re-arms on foreground;
  notification taps drive the web's URL hash (cold-start and runtime); Android
  back button walks WebView history; external origins (OAuth consent) open in
  the system browser; load/error/setup states.
- **`android/src/lib/shell.ts`** (new) — `WEB_URL`, the `__MYPRO_SHELL__`
  marker injected before content, the deep-link whitelist, and the
  `EXPO_PUBLIC_SHELL` flag.
- **`frontend/src/lib/shell.ts`** (new) — the single place the web reads
  `inShell`. Adds the `.in-shell` body class, sets `viewport-fit=cover` (shell
  only — `index.html` still omits it on purpose), exposes `postToShell`, and
  **bridges the session out** via `onAuthChange`. `main.tsx` calls `initShell()`
  before paint.
- **`frontend/src/index.css`** — one `.in-shell` block (overscroll off,
  `touch-action: manipulation`, no tap flash/callout, no text-select on chrome;
  the reader and inputs are left selectable).
- **`frontend/src/App.tsx`** — `usePush` gated on `!inShell` (or notifications
  double); a `hashchange` listener so a deep link into an already-open app
  re-routes (also fixes browser back/forward on the view hash).
- **`shared/src/auth.ts`** — added `setSession(session)` to the `Auth`
  contract + impl; the bridge the shell adopts the web's session through.
- **`android/package.json`** — `react-native-webview@13.12.5` (a native module;
  autolinked by `expo prebuild`, so the APK pipeline needs no new step).
- **`.github/workflows/android.yml`** — passes `EXPO_PUBLIC_WEB_URL` (secret)
  and `EXPO_PUBLIC_SHELL` (var) into the build.
- **`android/.env.example`** documents both new vars.

### The rule it was built under
Every shell branch lives in `lib/shell.ts` and changes only how the app *feels*,
never *what the user can do* — so the second app cannot grow back. Web push is
the one correctness branch (gate it, or notifications double).

## Before it ships (your steps)
1. **Set `EXPO_PUBLIC_WEB_URL`** to the Vercel app as a repository secret (CI)
   and in `android/.env` (local). Without it the shell shows a setup screen.
2. **Step 0 + spike on a real phone** (ANDROID_UPGRADE §3): install the APK,
   confirm sign-in, the reader, and that a brief fires with the laptop shut.
3. **Only then, delete the native screens** (step 6) and close Phase 13 bar
   13.2 (offline cache). To fall back meanwhile, set `EXPO_PUBLIC_SHELL=native`.

## Verified this session
- `npx tsc --noEmit` clean in `android/` and `frontend/`; `shared/` clean apart
  from two **pre-existing, environment-only** `RequestInfo` errors on untouched
  `doFetch` code (confirmed present with my changes stashed).
- `pnpm --dir frontend build` succeeds (needs pnpm's isolated linker locally —
  the react 18/19 hoist conflict of Phase 13.7; CI/Vercel are unaffected).
- `pnpm --dir shared test` — 14 passing.
- Android Metro bundled 867 modules (all new files + `react-native-webview`);
  the only failure was a Git-LFS *pointer stub* for a logo PNG, which CI pulls
  for real (`lfs: true`).
- **Not verified (needs a device):** sign-in and the reader in the WebView, a
  brief firing with the laptop shut, deep links, the back button, and the
  in-shell feel. All headless-impossible.

## Still true from earlier sessions
- Web `https://mypro-by-gova.vercel.app` · Render `https://mypro-km2k.onrender.com`
  (`/api/v1`) · Supabase ref `kssucdvrfzbdkyzovmjo`.
- Tests: Vitest — `pnpm --dir shared|frontend test`, `npm test` in each backend;
  backend tests in `test/`.
- Auth brokered by Render; clients hold no Supabase creds except the publishable
  key from `GET /me/realtime`.
- `performSupabaseUpload` in `utils/pdfStorage.ts` is still a fake progress
  simulator — only extracted JSON syncs, never the raw PDF.
- Commit only when asked; use the co-author line the session's attribution gives.
- Phase 16 (companion) is built and unit-tested but unproven live; it needs
  migrations `0009`–`0011` applied and the agent rebuilt.
