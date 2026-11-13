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
  /** Public JWKS endpoint used to verify client tokens. */
  SUPABASE_JWKS_URL: z.string().url(),

  /** Shared secret for render→laptop calls. Must match backend-local. */
  INTERNAL_SERVICE_TOKEN: z.string().min(32),

  /**
   * Optional fallback only. Normally the laptop's URL is discovered from
   * node_status.base_url, which it heartbeats on every start — so an
   * ephemeral Cloudflare quick-tunnel URL needs no redeploy here.
   */
  LOCAL_AGENT_URL: optionalUrl(),

  /** Encrypts Gmail OAuth tokens at rest. Generate: openssl rand -base64 32 */
  TOKEN_ENCRYPTION_KEY: z.string().min(32),

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
