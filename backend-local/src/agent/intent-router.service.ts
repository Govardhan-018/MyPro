import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { LlmService } from '../llm/llm.service';
import type { Capability } from '../capabilities/capability.types';
import { CapabilityRegistry } from '../capabilities/capability.registry';
import type { EffortBudget } from './effort';

export interface RouteResult {
  /** Capability names to offer the model this turn, strongest first. */
  capabilities: string[];
  /** The keyword pass found too little and the set was widened. */
  ambiguous: boolean;
  /** A model call was spent narrowing it. */
  viaModel: boolean;
  scores: Record<string, number>;
}

/** Keep the router's own prompt tiny — it exists to save tokens, not spend them. */
const DESCRIPTION_CHARS = 90;
/** Shared with the model's reasoning — see the warning on `maxTokens`. */
const ROUTER_MAX_TOKENS = 1_200;

const ROUTER_SYSTEM = [
  'You route a request to the capabilities needed to satisfy it.',
  'Reply with ONLY a JSON array of capability names, most important first.',
  'Include every capability the request needs, including ones needed to check',
  'or look something up before acting. Include nothing else. No prose.',
  'If nothing fits, reply [].',
].join('\n');

/**
 * Intent routing: decide which capabilities this request needs.
 *
 * Two passes, cheap first. The keyword pass (`capability.routing.ts`) is free
 * and settles most requests. Only when it is ambiguous — a request whose words
 * match little, which is exactly when offering all 28 schemas is most
 * wasteful — is one small model call spent narrowing the list.
 *
 * Routing can only ever *narrow* within the user's eligible set; the health
 * grant and every other permission decision happened before this ran.
 */
@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly llm: LlmService,
  ) {}

  async route(params: {
    text: string;
    capabilities: Capability[];
    budget: EffortBudget;
    model?: string;
  }): Promise<RouteResult> {
    const { text, capabilities, budget } = params;

    const keyword = this.registry.select(text, capabilities, {
      limit: budget.maxCapabilities,
      minConfident: 1,
    });

    if (!keyword.ambiguous) {
      return { capabilities: keyword.selected, ambiguous: false, viaModel: false, scores: keyword.scores };
    }

    // Light mode never spends a model call on routing: it is the mode whose
    // whole point is one cheap round trip.
    if (budget.mode === 'light') {
      return { capabilities: keyword.selected, ambiguous: true, viaModel: false, scores: keyword.scores };
    }

    const narrowed = await this.askModel(text, capabilities, params.model);
    if (!narrowed?.length) {
      return { capabilities: keyword.selected, ambiguous: true, viaModel: false, scores: keyword.scores };
    }

    // Always-on capabilities stay, whatever the model said.
    const always = capabilities.filter((c) => c.always && c.enabled).map((c) => c.name);
    const merged = [...new Set([...always, ...narrowed])].slice(0, budget.maxCapabilities);

    return { capabilities: merged, ambiguous: true, viaModel: true, scores: keyword.scores };
  }

  /** One small call. Returns null on anything it cannot trust. */
  private async askModel(
    text: string,
    capabilities: Capability[],
    model?: string,
  ): Promise<string[] | null> {
    const eligible = capabilities.filter((c) => c.enabled);
    const catalogue = eligible
      .map((c) => `${c.name}: ${c.description.slice(0, DESCRIPTION_CHARS)}`)
      .join('\n');

    try {
      const res = await this.llm.generate({
        model: env().ASSISTANT_ROUTER_MODEL || model,
        temperature: 0,
        maxTokens: ROUTER_MAX_TOKENS,
        reasoningEffort: 'low',
        system: `${ROUTER_SYSTEM}\n\nCAPABILITIES\n${catalogue}`,
        messages: [{ role: 'user', text }],
      });

      const match = res.text.match(/\[[\s\S]*\]/);
      if (!match) return null;
      const parsed: unknown = JSON.parse(match[0]);
      if (!Array.isArray(parsed)) return null;

      const known = new Set(eligible.map((c) => c.name));
      const names = parsed.filter((n): n is string => typeof n === 'string' && known.has(n));
      return names.length ? names : null;
    } catch (err) {
      // Routing is an optimisation. If it fails, the wider set still works.
      this.logger.warn(`router call failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
