import { z } from 'zod';

/**
 * backend-render — the always-on core API (deployed on Render).
 * All CRUD, the scheduler, notification dispatch. No LLM here: work that
 * needs generated text is delegated to the laptop agent (backend-local),
 * and degrades to plain messages when the laptop is offline.
 *
 * Fail fast on boot if the environment is incomplete.
 */
/**
 * A blank line in a .env file ("FOO=") arrives as "", not undefined, which
 * would fail .url(). Treat empty as absent for every optional field.
 */
const blankAsUndefined = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), inner);

const optionalUrl = () => blankAsUndefined(z.string().url().optional());
const optionalText = () => blankAsUndefined(z.string().optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(8080),

  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  SUPABASE_URL: z.string().url(),
  /** Public key (sb_publishable_…) — used with the caller's JWT, RLS applies. */
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  /** Secret key (sb_secret_…) — bypasses RLS. Server only. */
  SUPABASE_SECRET_KEY: z.string().min(20),
  /**
   * Deprecated/optional: the JWKS endpoint is now derived from SUPABASE_URL in
   * the auth guard, so a stale value here can't lock users out. Kept optional
   * for backward compatibility; no longer read.
   */
  SUPABASE_JWKS_URL: z.string().url().optional(),

  /** Shared secret for render→laptop calls. Must match backend-local. */
  INTERNAL_SERVICE_TOKEN: z.string().trim().min(32),

  /**
   * Optional fallback only. Normally the laptop's URL is discovered from
   * node_status.base_url, which it heartbeats on every start — so an
   * ephemeral Cloudflare quick-tunnel URL needs no redeploy here.
   */
  LOCAL_AGENT_URL: optionalUrl(),

  /** Encrypts Gmail OAuth tokens at rest. Generate: openssl rand -base64 32 */
  TOKEN_ENCRYPTION_KEY: z.string().min(32),

  /**
   * Google OAuth for Gmail (Phase 7). All three or nothing — the connect
   * flow reports "not configured" rather than half-working.
   *
   * ⚠️ An OAuth app left in **Testing** in the Google Cloud console issues
   * refresh tokens that expire after 7 days, so the mailbox silently
   * disconnects every week. Publishing it needs Google's verification review
   * for the restricted `gmail.readonly` scope — free, but slow.
   */
  /**
   * Strava (Phase 20.5). Create an app at strava.com/settings/api; the
   * redirect URI must be this service's /api/v1/strava/callback. Read-only
   * scopes are requested in code, not here.
   */
  STRAVA_CLIENT_ID: optionalText(),
  STRAVA_CLIENT_SECRET: optionalText(),
  STRAVA_REDIRECT_URI: optionalUrl(),

  GOOGLE_CLIENT_ID: optionalText(),
  GOOGLE_CLIENT_SECRET: optionalText(),
  /**
   * Optional override. Normally **derived** — `<public API base>/api/v1/gmail/callback`
   * from `PUBLIC_API_URL` or Render's own `RENDER_EXTERNAL_URL` — so nobody types
   * a redirect URL. Set it only if the API sits behind a different public host.
   */
  GOOGLE_REDIRECT_URI: optionalUrl(),
  /**
   * This API's public origin, e.g. https://mypro-api.onrender.com. Optional on
   * Render, which sets `RENDER_EXTERNAL_URL` itself; needed elsewhere (local
   * dev behind a tunnel) for the OAuth callback URL to be derived.
   */
  PUBLIC_API_URL: optionalUrl(),
  /** Set automatically by Render to the service's public URL. Never set by hand. */
  RENDER_EXTERNAL_URL: optionalUrl(),
  /** Where the callback sends the browser once the mailbox is connected. */
  APP_URL: optionalUrl(),


  /**
   * The in-process clock — **off by default since Phase 11**.
   *
   * Render's free instance sleeps after ~15 minutes of inactivity, so a cron
   * living here silently stops firing: the morning brief, the one thing the
   * product exists for, simply did not happen. The drain loop moved to
   * backend-local (the laptop) and the firing moved to the phone's OS.
   *
   * Set it to 'true' only for local development, or if render is ever on a
   * paid always-on instance. Two drain loops against the same table would
   * race and double-send.
   */
  SCHEDULER_ENABLED: blankAsUndefined(
    z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  ),

  TELEGRAM_BOT_TOKEN: optionalText(),
  WEB_PUSH_PUBLIC_KEY: optionalText(),
  WEB_PUSH_PRIVATE_KEY: optionalText(),
  WEB_PUSH_SUBJECT: optionalText(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
