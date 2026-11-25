import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { env } from '../config/env';

/**
 * This API's own public root (…/api/v1), from Render's RENDER_EXTERNAL_URL or
 * PUBLIC_API_URL. Null when the process cannot know it. Pure; unit-tested.
 */
export function selfApiUrl(vars: { PUBLIC_API_URL?: string; RENDER_EXTERNAL_URL?: string }): string | null {
  const origin = (vars.PUBLIC_API_URL || vars.RENDER_EXTERNAL_URL || '').trim();
  if (!origin) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(origin) ? origin : `https://${origin}`);
    const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
    return `${url.origin}${path}/api/v1`;
  } catch {
    return null;
  }
}

/** The agent counts as reachable if it heartbeat within this window. */
export const AGENT_STALE_AFTER_MS = 90_000;

export interface AgentPresence {
  online: boolean;
  last_heartbeat_at: string | null;
  base_url: string | null;
}

/**
 * Render only *reads* presence — the laptop (backend-local) writes its own
 * heartbeat row. Render itself is online by definition while it serves.
 */
@Injectable()
export class NodeStatusService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NodeStatusService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Say where this API lives the moment it starts (see {@link announce}). */
  async onApplicationBootstrap(): Promise<void> {
    await this.announce('boot');
  }

  /**
   * Record this API's own address in `node_status` (node = 'render'), so the
   * agent calls the real host instead of trusting a hand-set RENDER_API_URL —
   * a wrong host there made every scheduled email fail with a 404 from
   * Render's edge. `base_url` keeps the web app's address (APP_URL) as
   * before; the API root goes in `detail.api_url`.
   */
  async announce(source: string): Promise<{ error: string | null }> {
    const api_url = selfApiUrl({
      PUBLIC_API_URL: (process.env.PUBLIC_API_URL ?? '').trim() || undefined,
      RENDER_EXTERNAL_URL: (process.env.RENDER_EXTERNAL_URL ?? '').trim() || undefined,
    });
    const { error } = await this.supabase.admin.from('node_status').upsert(
      {
        node: 'render',
        base_url: env().APP_URL ?? null,
        last_heartbeat_at: new Date().toISOString(),
        detail: { source, node_env: env().NODE_ENV, api_url },
      },
      { onConflict: 'node' },
    );
    if (error) this.logger.warn(`could not record this node's address: ${error.message}`);
    return { error: error?.message ?? null };
  }

  async agent(): Promise<AgentPresence> {
    const { data } = await this.supabase.admin
      .from('node_status')
      .select('last_heartbeat_at, base_url')
      .eq('node', 'local')
      .maybeSingle();

    if (!data) return { online: false, last_heartbeat_at: null, base_url: null };
    const row = data as { last_heartbeat_at: string; base_url: string | null };
    const age = Date.now() - new Date(row.last_heartbeat_at).getTime();
    return {
      online: age < AGENT_STALE_AFTER_MS,
      last_heartbeat_at: row.last_heartbeat_at,
      base_url: row.base_url,
    };
  }

  async agentOnline(): Promise<boolean> {
    return (await this.agent()).online;
  }
}
