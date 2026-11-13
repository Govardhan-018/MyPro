import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { NodeStatusService } from './node-status.service';

export class AgentUnavailableError extends Error {
  constructor(reason: string) {
    super(`laptop agent unavailable: ${reason}`);
    this.name = 'AgentUnavailableError';
  }
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentPersona {
  name?: string | null;
  tone?: string | null;
  style_notes?: string | null;
}

/**
 * render → laptop. Used by the scheduler when a job needs generated text.
 * The persona travels with the request; the prompt itself is built on the
 * laptop so that logic lives in exactly one place.
 */
@Injectable()
export class AgentClient {
  private readonly logger = new Logger(AgentClient.name);

  constructor(private readonly nodes: NodeStatusService) {}

  /**
   * Where the laptop is right now. It heartbeats its own public URL into
   * node_status on every start, so an ephemeral Cloudflare quick-tunnel
   * hostname works with no redeploy here. The env var is only a fallback
   * for a fixed/named tunnel.
   */
  private async resolveBase(): Promise<string | null> {
    const presence = await this.nodes.agent();
    if (presence.online && presence.base_url) return presence.base_url;
    return env().LOCAL_AGENT_URL ?? null;
  }

  async available(): Promise<boolean> {
    return Boolean(await this.resolveBase()) && (await this.nodes.agentOnline());
  }

  async complete(params: {
    userId: string;
    persona: AgentPersona;
    messages: AgentMessage[];
    model?: string;
    temperature?: number;
    timeoutMs?: number;
  }): Promise<string> {
    if (!(await this.nodes.agentOnline())) throw new AgentUnavailableError('no recent heartbeat');
    const base = await this.resolveBase();
    if (!base) throw new AgentUnavailableError('laptop has not published a URL');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 30_000);

    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/internal/ai/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': env().INTERNAL_SERVICE_TOKEN,
        },
        body: JSON.stringify({
          user_id: params.userId,
          persona: params.persona,
          messages: params.messages,
          model: params.model,
          temperature: params.temperature,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new AgentUnavailableError(`responded ${res.status}`);
      const body = (await res.json()) as { text?: string };
      if (!body.text) throw new AgentUnavailableError('empty response');
      return body.text;
    } catch (err) {
      if (err instanceof AgentUnavailableError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`agent call failed: ${reason}`);
      throw new AgentUnavailableError(reason);
    } finally {
      clearTimeout(timer);
    }
  }
}
