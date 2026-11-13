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
  /** Public JWKS endpoint used to verify client tokens. */
  SUPABASE_JWKS_URL: z.string().url(),

  /** Shared secret for render→laptop calls. Must match backend-render. */
  INTERNAL_SERVICE_TOKEN: z.string().min(32),

  /**
   * This machine's public HTTPS origin, heartbeated into node_status so
   * render and the web app can find it. With a Cloudflare quick tunnel this
   * changes on every start — start-agent.bat fills it in automatically.
   */
  PUBLIC_BASE_URL: optionalUrl(),

  /** Groq (console.groq.com). Never leaves this machine. */
  GROQ_API_KEY: z.string().min(10),
  ASSISTANT_MODEL: z.string().default('openai/gpt-oss-120b'),

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
