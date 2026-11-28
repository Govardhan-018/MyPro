# MyPro

Personal assistant platform. One repo, three deployables:

| Folder | What it is | Where it runs |
|---|---|---|
| `frontend/` | React 19 + Vite + Tailwind v4 web app | Vercel (dev server locally) |
| `backend-render/` | Always-on core API: CRUD, scheduler, notifications (NestJS) | Render |
| `backend-local/` | Personal agent: assistant chat + LLM, agent core, research, the clock (NestJS) | Render (`mypro-agent`), or the laptop for dev |
| `supabase/` | Postgres migrations (4NF schema + RLS + health consent gate) | Supabase cloud |

Routing rule: the web/app call **backend-render** for everything except
`/assistant/*`, which goes straight to **backend-local**. When the laptop is
offline (heartbeat stale ~90s), the UI greys out the assistant and render
degrades AI-dependent scheduled jobs to plain messages.

**The agent's address is discovered, never hardcoded.** It heartbeats its own
`PUBLIC_BASE_URL` into `node_status` every 30s, and both render
(`AgentClient.resolveBase`) and the web app (`resolveAgentBase` in `api.ts`)
read it from there. On Render that is a fixed `https://mypro-agent.onrender.com`;
in local dev `start-agent.bat` opens a Cloudflare quick tunnel and fills in the
random `*.trycloudflare.com` URL. Either way, nothing hardcodes it.

**Only one node may run the clock.** `SCHEDULER_ENABLED` is true on whichever
agent is live and false everywhere else — two drain the same rows and
double-send. See `docs/DEPLOY_AGENT_TO_RENDER.md`.

Secrets live only in each deployable's `.env` (`.env.example` holds
placeholders **only** and is committed — never put real values in it), or in
the Render dashboard for a deployed service. Supabase uses
the current key format: `sb_publishable_…` + `sb_secret_…`, with client JWTs
verified against the project's JWKS endpoint.

## Development

- Frontend: `pnpm --dir frontend dev` (or `pnpm dev` from the root, which
  delegates). The Vite server reads `$PORT` (default 8443). `.figma/` stays at
  the repo root; `frontend/vite.config.ts` references it as `../.figma/`.
- Backends: `npm run dev` inside `backend-render/` or `backend-local/`.
  Both refuse to boot with an incomplete `.env` (zod-validated; blank values
  count as absent for optional vars).
- The agent, with a public address: `start-agent.bat` from the repo root.
- Type checks: `npx tsc --noEmit` in each of the three folders.
- Tests (Vitest): `pnpm --dir shared test` and `pnpm --dir frontend test`;
  `npm test` inside `backend-render/` and `backend-local/`. `test:watch` in
  each for the watch loop. Backend tests live in `test/` (out of the Nest
  build); shared/frontend tests sit beside their source.

## Frontend structure

- `frontend/src/main.tsx` — entrypoint; imports `index.css` + `reading-listening.css`
- `frontend/src/App.tsx` — primary application component (all views)
- `frontend/src/components/` — library reader, podcast player, settings views
- `frontend/src/lib/` — `env.ts` (VITE_* config), `supabase.ts` (auth),
  `api.ts` (typed client; `api.assistant.*` targets the agent, the rest render)
- `frontend/src/types/`, `frontend/src/data/`, `frontend/src/utils/`

## Styling (frontend)

Tailwind CSS v4 via `@tailwindcss/vite`; `src/index.css` does
`@import 'tailwindcss';`. Use utility classes in JSX; global CSS and theme
customization live in `src/index.css` (app shell) and
`src/reading-listening.css` (reader/library additions). No Tailwind config or
PostCSS file is needed.

Tailwind emits utilities in `@layer utilities`, and CSS outside any cascade
layer overrides every layer regardless of specificity, so put global element
styles (resets, `body`, headings, `button`, `input` defaults) inside
`@layer base { ... }`. Preflight already applies `box-sizing: border-box`,
removes default margins, and sets `font: inherit` on form controls — do not
repeat those.

Typography: one family per job, bundled in `frontend/src/lib/fonts.ts` (Latin
subsets only — every font file is precached for offline). Use the CSS
variables, never a literal family:
- `--font-display` (Changa One) — every page title (`.page-heading h1`), the
  greeting, welcome screens, and mid-size stat numbers.
- `--font-heading` (Space Grotesk) — headings and card titles; also
  `--font-ui`, which every button, tab, chip, toggle and menu uses.
- `--font-body` (Outfit) — descriptions, messages, inputs.
- `--font-mono` (JetBrains Mono) — times, dates, counts, durations, page
  numbers, and the small uppercase kickers/labels.
- `--font-hero` (Black Ops One) — only numerals ≥ ~28px; its stencil cuts
  break up smaller.
- `--font-serif` (Literata) — long-form reading.
The role map lives at the end of `src/index.css` ("Type roles").

Design system: pure black `#000`, graphite surfaces, white typography with
size-based hierarchy, thin `rgba(255,255,255,.1…)` borders, rounded cards,
global Monochrome/Color Mode (accents only under `.color-mode`, 1000ms
transitions).

## Rules of the road

- Read only what the task needs; prefer targeted edits.
- Do not run tests/builds/typechecks unless asked (installing a dependency a
  change requires is fine).
- Never hardcode secrets, URLs, or model names — env only.
- The architecture contract is `docs/BACKEND_PLAN.md`; update it when the
  topology or schema changes.
- The assistant as actually built is `docs/AI_SYSTEM.md`, and the agent core
  (capability routing, planning, verification, effort modes) is
  `docs/AGENT_SPEC.md`. A new skill needs an entry in
  `capabilities/capability.meta.ts` or the registry test fails.
- **What to build next lives in `docs/PHASES.md`** — every phase, its goal and
  its status, in one file. Keep it current; it is what a new chat reads.
