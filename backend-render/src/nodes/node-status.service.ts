import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

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
export class NodeStatusService {
  constructor(private readonly supabase: SupabaseService) {}

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
