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
  INTERNAL_SERVICE_TOKEN: z.string().trim().min(32),

  /**
   * backend-render's API root, e.g. https://mypro-xxxx.onrender.com/api/v1
   *
   * Used for the few things render is the only half able to do: sending mail
   * (Phase 7.6), because the Gmail tokens and the key that decrypts them live
   * only there. Without it, `send_email` declines clearly rather than failing.
   */
  RENDER_API_URL: blankAsUndefined(
    z.preprocess(
      // Render's blueprint fills this from the core's bare host
      // ("mypro-core.onrender.com"); accept that as well as a full URL.
      (v) => (typeof v === 'string' && v.trim() && !/^https?:\/\//i.test(v.trim()) ? `https://${v.trim()}` : v),
      z.string().url().optional(),
    ),
  ),

  /**
   * This machine's public HTTPS origin, heartbeated into node_status so
   * render and the web app can find it. With a Cloudflare quick tunnel this
   * changes on every start — start-agent.bat fills it in automatically.
   */
  PUBLIC_BASE_URL: optionalUrl(),

  /** Groq (console.groq.com). */
  GROQ_API_KEY: z.string().min(10),
  /**
   * Google AI Studio (aistudio.google.com/apikey). Optional second vendor.
   *
   * Worth having because the two fail in opposite ways: Groq's free tier is
   * 8,000 tokens per minute, which one multi-step turn can exhaust, while
   * Gemini Flash Lite is 250,000 TPM and 500 requests a day but answers 503
   * "high demand" under load. Either can cover the other.
   */
  GEMINI_API_KEY: optionalText(),
  /**
   * Cohere (dashboard.cohere.com/api-keys). OpenAI-compatible endpoint, and
   * the fastest of the four measured here — ~0.5s with working tool calls.
   * A trial key is free but monthly-capped, so it earns its place as a
   * fallback rather than as the everyday chat model.
   */
  COHERE_API_KEY: optionalText(),
  /**
   * SambaNova (cloud.sambanova.ai). Also OpenAI-compatible, but on the free
   * plan most of its catalogue answers 402 "payment method required" — only
   * the Gemma model served without one. No tool calling, so it is useful
   * for routing and planning and nothing else.
   */
  SAMBANOVA_API_KEY: optionalText(),
  /**
   * Tried once when the configured model fails after its retries, in the
   * same `vendor:model` form. Point it at the OTHER vendor or it buys
   * nothing. Blank disables the fallback.
   */
  LLM_FALLBACK_MODEL: optionalText(),
  /** Wall-clock ceiling on a single model call. */
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * The chat model, optionally prefixed with its vendor:
   *   openai/gpt-oss-120b              (Groq, the default)
   *   gemini:gemini-flash-lite-latest  (Gemini)
   * An unprefixed value means Groq, so existing deployments are unaffected.
   */
  ASSISTANT_MODEL: z.string().default('openai/gpt-oss-120b'),
  /**
   * Optional cheaper models for the two classification-shaped calls in the
   * agent core: routing a request to capabilities, and turning it into a
   * plan. Blank → the turn's own model, so leaving these unset changes
   * nothing. Never hardcode a name here; Groq's catalogue moves.
   */
  ASSISTANT_ROUTER_MODEL: optionalText(),
  ASSISTANT_PLANNER_MODEL: optionalText(),

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

  /* ---- research providers (Phase 20) ----------------------------------
   * Every one optional: with none of them set, research still works on the
   * free keyless providers (Wikipedia, GDELT, TheSportsDB's public test key,
   * Open-Meteo). Adding a key promotes a better provider; the chain order is
   * in RESEARCH_*_PROVIDERS. See docs/RESEARCH_PROVIDERS.md.
   */
  TAVILY_API_KEY: optionalText(),
  BRAVE_SEARCH_API_KEY: optionalText(),
  /** Origin of a SearXNG instance you trust, e.g. https://searx.example.org */
  SEARXNG_BASE_URL: optionalUrl(),
  NEWSDATA_API_KEY: optionalText(),
  GUARDIAN_API_KEY: optionalText(),
  /**
   * Comma-separated RSS/Atom feed URLs. Free, keyless news from sources you
   * chose — nothing is hardcoded, because whose news this is should be your
   * decision. Up to 8 are read.
   */
  NEWS_RSS_FEEDS: optionalText(),
  /** Blank uses TheSportsDB's public test key, which works but is throttled. */
  THESPORTSDB_API_KEY: optionalText(),
  FIRECRAWL_API_KEY: optionalText(),

  /**
   * Comma-separated provider ids, best first. Blank → the built-in order,
   * filtered to whatever is configured. An unknown id is logged and skipped.
   */
  RESEARCH_SEARCH_PROVIDERS: optionalText(),
  RESEARCH_NEWS_PROVIDERS: optionalText(),
  RESEARCH_SPORTS_PROVIDERS: optionalText(),
  RESEARCH_EXTRACT_PROVIDERS: optionalText(),
  RESEARCH_WEATHER_PROVIDERS: optionalText(),

  /** How we identify ourselves when fetching. Never the user's details. */
  RESEARCH_USER_AGENT: optionalText(),
  /** Byte ceiling on a fetched body, enforced while streaming. */
  RESEARCH_MAX_FETCH_BYTES: z.coerce.number().int().positive().default(1_500_000),
  RESEARCH_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
  /** Minimum gap between two requests to the same host. */
  RESEARCH_HOST_DELAY_MS: z.coerce.number().int().min(0).default(1_000),
  /** Characters of extracted page text the model is shown. */
  RESEARCH_MAX_PAGE_CHARS: z.coerce.number().int().positive().default(6_000),
  /** Cache lifetime for search, news, fixtures and pages. 0 disables caching. */
  RESEARCH_CACHE_TTL_MINUTES: z.coerce.number().int().min(0).default(180),
  /** Forecasts go stale faster than articles do. */
  RESEARCH_WEATHER_TTL_MINUTES: z.coerce.number().int().min(0).default(30),

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

/**
 * The core's API root for node-to-node calls, whatever form RENDER_API_URL was
 * given in: with or without https://, with or without a trailing slash, with
 * or without the /api/v1 prefix every Render route lives under. Without the
 * prefix every call 404'd — scheduled emails failed with "Render refused the
 * send (404)". Null when unset. Pure; unit-tested.
 */
export function renderApiBase(): string | null {
  return normalizeRenderBase(env().RENDER_API_URL);
}

/** The pure half of {@link renderApiBase}. */
export function normalizeRenderBase(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const trimmed = withScheme.replace(/\/+$/, '');
  return /\/api\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/api/v1`;
}
