# MyPro — Session Handoff

What the last session changed. `docs/PHASES.md` is the durable plan; this file
is volatile. Read `AGENTS.md` too.

## This session: Phase 12.4 — the repo's first tests

The repo had **zero tests** and 21 skills, one of which now sends real email
to real people (7.6). This session added **Vitest** and the pure-logic unit
tests Phase 12.4 asked for: **41 tests across all four packages, all green.**
Phase 12 is now partly done (12.3 + 12.4); **12.1 (skill tests) and 12.2
(routing evals) are what's left.**

### The test runner — Vitest, one tool across four packages

| Package | Run | Env | Where tests live |
|---|---|---|---|
| `shared/` | `pnpm --dir shared test` | node | `src/*.test.ts` (beside source) |
| `frontend/` | `pnpm --dir frontend test` | node | `src/**/*.test.ts` |
| `backend-render/` | `npm test` (in the dir) | node | `test/*.test.ts` |
| `backend-local/` | `npm test` (in the dir) | node | `test/*.test.ts` |

`test:watch` in each gives the watch loop — the "know within a minute" the
Phase 12 goal is about.

- **The backends are separate npm projects**, not workspace members, so vitest
  was installed into each with `npm`, their configs are `vitest.config.mts`
  (ESM, or a `.ts` config warns under their CommonJS setup), and their tests
  live in `test/` — **outside `src/`**, so they stay out of `nest build` and
  `tsc --noEmit`, which include `src` only.
- `shared` and `frontend` got vitest via `pnpm add` (workspace); their tests
  sit beside the source. **Vitest 5.1.0**, which pairs with the frontend's
  Vite 8. `jsdom` was installed in frontend but is unused — see below.

### What's covered (12.4)

- **`computeNextRun`** — `once` / `daily` / `weekly` / `monthly` (including the
  day-31 → last-day clamp) / `cron`, plus timezone resolution (08:30 in
  Asia/Kolkata → 03:00Z). Tested in **both** backends: the two copies are
  byte-identical (`backend-local`'s differs only by a header comment and the
  extra `expandOccurrences`), so the laptop suite mirrors render's exactly.
  **This is the test that catches a change that landed in only one half.**
- **`expandOccurrences`** (render) — daily window expansion, empty when the
  only occurrence is past the window, and the runaway-cron `cap` (a
  `* * * * *` over ten days returns exactly 64, not ~14k).
- **`groupParagraphs` / `groupBlocks` / `ocrParagraphs`** (shared) — paragraph
  breaks on wide gaps, heading/subheading/caption classification by size
  relative to the page body, hyphen stitching, page-number furniture drop, and
  OCR blank-line splitting with single-char noise dropped.
- **`dateKeyOf`** (frontend) — the local-vs-UTC day bug it was written to fix.
  Its config pins `TZ=America/New_York` (`frontend/vitest.config.ts`) so the
  timed case is deterministic; `02:00Z` on the 17th correctly keys to the 16th.

### Two decisions worth knowing

- **Frontend tests run in the `node` environment, not `jsdom`.** jsdom 31 drags
  in `undici@8`, which crashes the worker at startup on this Node
  (`decompress.js` → `.bind` of undefined). `dateKeyOf` is pure date maths and
  its import graph (`./client`) touches `localStorage` only inside try/catch
  closures, never at load, so `node` works and avoids the whole problem. If a
  future frontend test genuinely needs the DOM, that undici issue has to be
  solved first (pin undici, or a newer jsdom).
- **TZ is pinned via `process.env.TZ` + `pool: 'forks'`** so each worker is a
  fresh process that reads the zone at startup — the reliable way to make a
  date test deterministic across machines.

### Still pending by hand (unchanged from before)

Migrations are not applied by committing them. In the Supabase dashboard:
`0005`, `0006`, `0007`, and `0008_pending_action_result.sql` (without the last,
**approving an outward action throws** — the approve route writes that column).

## What's next (in order)

1. **Phase 12.1 — skill tests.** `run(args, ctx)` takes an injected db, so each
   of the 21 skills is directly testable: assert the row written, the receipt,
   and the side-effect tier (`read` / `write` / `outward`). The harness is now
   in place — this is the same Vitest setup pointed at the skills.
2. **Phase 12.2 — routing evals.** A fixture of utterance → expected skill +
   args, scored against the real model, so a 21-skill prompt does not degrade
   when the 22nd is added. (Needs the laptop's model key; runs on the laptop.)
3. **Phase 13.2 — an offline cache on the phone.** Its screens are done; the
   library list, calendar, brief and chat are still network-only.
4. **Phase 18.2 — the theme tokens.** `--graphite`/`--medium`/`--soft`/
   `--accent`/`--deep`/`--secondary` are all `#ffffff`, used ~97 times; four
   invisible-element bugs so far. Replace with a graded monochrome scale.
5. **Phase 16** — commitments and the Pulse, the phase that changes how it
   feels.

Also open, and mostly **yours** (no code can do them): the Android WebView
cutover decision (`docs/ANDROID_UPGRADE.md` §3 step 0 — a two-minute phone
test), the Google OAuth app for Gmail, an EAS project id for push, and proving
a brief actually fires on a real phone.

## Not verified

The tests themselves pass locally (`41 passed`). Not run this session:
`tsc --noEmit` and the frontend build — the test dirs are excluded from both,
so neither should be affected, but neither was re-run. Nothing signed-in was
exercised (a sandbox cannot): no notification armed on a real phone, no mailbox
connected, no push to a closed browser, no brief from the moved drain loop, no
scanned PDF through OCR, and the Android screens have still never been run.

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
- Commit only when asked, and use the co-author line your session's own
  attribution specifies.
