import { z } from 'zod';

/**
 * backend-local — the personal agent that runs on your laptop.
 * It is the only place the LLM runs and the only holder of the
 * ANTHROPIC key. It talks to Supabase directly for data, serves
 * /assistant/* straight to the web/app, and heartbeats so render
 * and the UI know when it is awake.
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
  PORT: z.coerce.number().int().positive().default(8787),

  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  SUPABASE_URL: z.string().url(),
  /** Public key (sb_publishable_…) — used with the caller's JWT, RLS applies. */
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  /** Secret key (sb_secret_…) — bypasses RLS. Server only. */
  SUPABASE_SECRET_KEY: z.string().min(20),
  /** Optional/deprecated: JWKS is now derived from SUPABASE_URL. No longer read. */
  SUPABASE_JWKS_URL: z.string().url().optional(),

  /** Shared secret for render→laptop calls. Must match backend-render. */
  INTERNAL_SERVICE_TOKEN: z.string().min(32),

  /**
   * backend-render's API root, e.g. https://mypro-xxxx.onrender.com/api/v1
   *
   * Used for the few things render is the only half able to do: sending mail
   * (Phase 7.6), because the Gmail tokens and the key that decrypts them live
   * only there. Without it, `send_email` declines clearly rather than failing.
   */
  RENDER_API_URL: optionalUrl(),

  /**
   * This machine's public HTTPS origin, heartbeated into node_status so
   * render and the web app can find it. With a Cloudflare quick tunnel this
   * changes on every start — start-agent.bat fills it in automatically.
   */
  PUBLIC_BASE_URL: optionalUrl(),

  /** Groq (console.groq.com). Never leaves this machine. */
  GROQ_API_KEY: z.string().min(10),
  ASSISTANT_MODEL: z.string().default('openai/gpt-oss-120b'),

  /**
   * The drain loop (Phase 11.1). On by default: this machine is the clock's
   * worker now that render's free instance is allowed to sleep. Turn it off to
   * run a second agent process without two of them racing for the same rows.
   */
  SCHEDULER_ENABLED: blankAsUndefined(
    z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  ),
  /**
   * How late a *recurring* job may be and still fire, in minutes. The laptop
   * may have been shut for days; "here is your day" at 11pm is not a morning
   * brief, so anything later than this is skipped to its next occurrence.
   * One-shots ignore this — late beats never. 0 disables the check.
   */
  SCHEDULER_STALE_MINUTES: z.coerce.number().int().min(0).default(120),

  /**
   * Web Push (Phase 6.2). Optional: without them the fan-out simply skips the
   * web-push channel. Generate a pair with `npx web-push generate-vapid-keys`.
   */
  WEB_PUSH_PUBLIC_KEY: optionalText(),
  WEB_PUSH_PRIVATE_KEY: optionalText(),
  /** 'mailto:you@example.com' — push services require a contact. */
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
