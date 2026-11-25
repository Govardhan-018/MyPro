import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeRenderBase, renderApiBase } from '../config/env';

/**
 * Where the core API (backend-render) actually lives.
 *
 * The core records its own root in `node_status` (node = 'render',
 * `detail.api_url`) on every start and keep-alive, from Render's own
 * RENDER_EXTERNAL_URL — so it is always the real host. RENDER_API_URL is only
 * the fallback: a hand-set value naming the wrong service is what made every
 * scheduled email fail with a 404 from Render's edge.
 *
 * Cached for five minutes; `forgetRenderApiBase()` after a failed call so the
 * next one looks again.
 */
let cache: { url: string; at: number } | null = null;
const CACHE_MS = 5 * 60_000;

export async function resolveRenderApiBase(admin: SupabaseClient): Promise<string | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.url;
  try {
    const { data } = await admin.from('node_status').select('detail').eq('node', 'render').maybeSingle();
    const announced = normalizeRenderBase(
      ((data as { detail?: { api_url?: string } } | null)?.detail?.api_url ?? null) as string | null,
    );
    if (announced) {
      cache = { url: announced, at: Date.now() };
      return announced;
    }
  } catch {
    /* fall back to the configured value */
  }
  return renderApiBase();
}

export function forgetRenderApiBase(): void {
  cache = null;
}
