import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SupabaseService } from '../common/supabase.service';
import { env } from '../config/env';
import type { ProviderKind } from './provider.types';

/**
 * The research cache and the usage ledger.
 *
 * Why cache at all: free tiers are measured in requests per day, the same
 * question gets asked twice (once by the user, once by the Pulse), and a
 * cached answer costs nothing and arrives instantly. Why record usage: when a
 * provider starts failing or a quota runs out, the only way to know is to have
 * been counting.
 *
 * Both tables are **service-role only** — RLS is on with no policies, so a
 * user's JWT can read neither. The cache holds public web content keyed by
 * query, and this is a single-person system, but the queries themselves are
 * personal, so nothing hands them back out through the API.
 *
 * Every method swallows its own failures. A cache that is down must degrade to
 * a cache miss, never to a failed answer.
 */

export interface UsageRecord {
  provider: string;
  kind: ProviderKind;
  ok: boolean;
  durationMs: number;
  /** True when the answer came from the cache and no provider was called. */
  cached?: boolean;
  error?: string;
  userId?: string;
}

@Injectable()
export class ResearchCacheService {
  private readonly logger = new Logger(ResearchCacheService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * A stable key for a request.
   *
   * Content-addressed so the same question always lands on the same row
   * whichever provider answers it: a cached Tavily result is still the answer
   * to the question when Brave is next in the chain. Values are normalised
   * (trimmed, lowercased, key-sorted) so trivial differences do not miss.
   */
  key(kind: ProviderKind, parts: Record<string, unknown>): string {
    const normalised = Object.keys(parts)
      .sort()
      .map((k) => {
        const value = parts[k];
        if (value === undefined || value === null || value === '') return '';
        const text = typeof value === 'string' ? value.trim().toLowerCase() : String(value);
        return `${k}=${text}`;
      })
      .filter(Boolean)
      .join('&');

    return createHash('sha256').update(`${kind}:${normalised}`).digest('hex');
  }

  /** The cached payload, or null on a miss, an expiry or any failure. */
  async get<T>(cacheKey: string): Promise<T | null> {
    if (env().RESEARCH_CACHE_TTL_MINUTES <= 0) return null;
    try {
      const { data, error } = await this.supabase.admin
        .from('research_cache')
        .select('payload, expires_at')
        .eq('cache_key', cacheKey)
        .maybeSingle();

      if (error || !data) return null;
      const row = data as { payload: unknown; expires_at: string };
      if (Date.parse(row.expires_at) <= Date.now()) return null;

      return row.payload as T;
    } catch (err) {
      this.logger.debug(`cache read failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Store a payload. `ttlMinutes` defaults to the configured TTL. */
  async put(params: {
    cacheKey: string;
    kind: ProviderKind;
    provider: string;
    payload: unknown;
    ttlMinutes?: number;
  }): Promise<void> {
    const ttl = params.ttlMinutes ?? env().RESEARCH_CACHE_TTL_MINUTES;
    if (ttl <= 0) return;

    try {
      await this.supabase.admin.from('research_cache').upsert(
        {
          cache_key: params.cacheKey,
          kind: params.kind,
          provider: params.provider,
          payload: params.payload as Record<string, unknown>,
          expires_at: new Date(Date.now() + ttl * 60_000).toISOString(),
          created_at: new Date().toISOString(),
        },
        { onConflict: 'cache_key' },
      );
    } catch (err) {
      this.logger.debug(`cache write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** One row per provider call — the quota and reliability record. */
  async record(usage: UsageRecord): Promise<void> {
    try {
      await this.supabase.admin.from('research_usage').insert({
        provider: usage.provider,
        kind: usage.kind,
        user_id: usage.userId ?? null,
        ok: usage.ok,
        cached: usage.cached ?? false,
        duration_ms: Math.round(usage.durationMs),
        error: usage.error?.slice(0, 500) ?? null,
      });
    } catch (err) {
      this.logger.debug(`usage write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Calls per provider since a cutoff — what a quota readout reads. */
  async usageSince(sinceMs: number): Promise<{ provider: string; kind: string; calls: number }[]> {
    try {
      const { data } = await this.supabase.admin
        .from('research_usage')
        .select('provider, kind')
        .gte('created_at', new Date(sinceMs).toISOString())
        .eq('cached', false)
        .limit(5_000);

      const counts = new Map<string, { provider: string; kind: string; calls: number }>();
      for (const row of (data ?? []) as { provider: string; kind: string }[]) {
        const key = `${row.provider}:${row.kind}`;
        const entry = counts.get(key) ?? { provider: row.provider, kind: row.kind, calls: 0 };
        entry.calls += 1;
        counts.set(key, entry);
      }
      return [...counts.values()].sort((a, b) => b.calls - a.calls);
    } catch {
      return [];
    }
  }
}
