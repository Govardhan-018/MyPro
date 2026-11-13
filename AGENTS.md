# MyPro

Personal assistant platform. One repo, three deployables:

| Folder | What it is | Where it runs |
|---|---|---|
| `frontend/` | React 19 + Vite + Tailwind v4 web app | Vercel (dev server locally) |
| `backend-render/` | Always-on core API: CRUD, scheduler, notifications (NestJS) | Render |
| `backend-local/` | Personal agent: assistant chat + LLM, Supabase access, heartbeat (NestJS) | The user's laptop |
| `supabase/` | Postgres migrations (4NF schema + RLS + health consent gate) | Supabase cloud |

Routing rule: the web/app call **backend-render** for everything except
`/assistant/*`, which goes straight to **backend-local**. When the laptop is
offline (heartbeat stale ~90s), the UI greys out the assistant and render
degrades AI-dependent scheduled jobs to plain messages.

**The laptop's address is dynamic.** `start-agent.bat` opens a Cloudflare
quick tunnel, captures the random `*.trycloudflare.com` URL and passes it as
`PUBLIC_BASE_URL`; the agent heartbeats it into `node_status`, and both render
(`AgentClient.resolveBase`) and the web app (`resolveAgentBase` in `api.ts`)
read it from there. Never hardcode the tunnel URL anywhere.

Secrets live only in each deployable's `.env` (`.env.example` holds
placeholders **only** and is committed — never put real values in it). The
model key (Groq) exists only on the laptop. Supabase uses
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
