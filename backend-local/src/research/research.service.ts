import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { ProviderRegistry } from './provider.registry';
import { ResearchCacheService } from './cache.service';
import { FetchRefused } from './http.service';
import type {
  ExtractResult,
  ProviderKind,
  SourceDoc,
  SportsResult,
  WeatherReport,
} from './provider.types';

/**
 * Research orchestration: cache, then the provider chain, with usage recorded
 * either way.
 *
 * Nothing above this file names a vendor. Everything it returns carries the
 * provider that answered and when it was fetched, because a source without a
 * provenance is not a source — it is a claim.
 *
 * Failure policy: a provider that throws is recorded and the chain continues.
 * Only when every provider in the chain has failed does this throw, and the
 * message names what was tried, so the model can tell the user something
 * true ("search is not configured" / "all three providers failed") instead of
 * inventing an answer.
 */

export interface SearchOutcome {
  sources: SourceDoc[];
  provider: string;
  cached: boolean;
}

export interface FixtureOutcome extends SportsResult {
  provider: string;
  cached: boolean;
}

export interface BriefOutcome {
  sources: SourceDoc[];
  /** Providers that contributed, search first. */
  providers: string[];
  /** Pages we tried to read in full but could not, with the reason. */
  unread: { url: string; reason: string }[];
}

class NoProvider extends Error {}

/**
 * How long a completely failed chain stays failed.
 *
 * Without this, a model that is told "search failed" simply tries again —
 * four times in one turn, in the first live run, each one a fresh 429 from a
 * provider that had already said no. Retrying a rate limit is the one thing
 * guaranteed not to clear it, and it burns the turn's step budget doing it.
 * Short enough that a transient blip recovers on the next question.
 */
const CHAIN_FAILURE_TTL_MS = 10 * 60_000;

@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);

  /** kind -> when the whole chain last failed, and why. In memory only. */
  private readonly chainDown = new Map<ProviderKind, { at: number; reason: string }>();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly cache: ResearchCacheService,
  ) {}

  /** Is any provider configured for this kind? Skills check before promising. */
  available(kind: ProviderKind): boolean {
    return this.registry.chain(kind).length > 0;
  }

  providers() {
    return this.registry.readout();
  }

  // ---- the five capabilities -------------------------------------------

  async search(params: {
    q: string;
    limit: number;
    freshnessDays?: number;
    userId?: string;
  }): Promise<SearchOutcome> {
    const limit = clamp(params.limit, 1, 10);
    const key = this.cache.key('search', {
      q: params.q,
      limit,
      fresh: params.freshnessDays ?? '',
    });

    return this.run('search', key, params.userId, this.registry.searchChain(), async (p) => {
      const sources = await p.search({
        q: params.q,
        limit,
        freshnessDays: params.freshnessDays,
      });
      return { sources: dedupe(sources).slice(0, limit), provider: p.id, cached: false };
    });
  }

  async news(params: {
    q?: string;
    topic?: string;
    limit: number;
    sinceDays?: number;
    userId?: string;
  }): Promise<SearchOutcome> {
    const limit = clamp(params.limit, 1, 10);
    const key = this.cache.key('news', {
      q: params.q ?? '',
      topic: params.topic ?? '',
      limit,
      since: params.sinceDays ?? '',
    });

    return this.run('news', key, params.userId, this.registry.newsChain(), async (p) => {
      const sources = await p.news({
        q: params.q,
        topic: params.topic,
        limit,
        sinceDays: params.sinceDays,
      });
      return { sources: dedupe(sources).slice(0, limit), provider: p.id, cached: false };
    });
  }

  async fixtures(params: {
    team?: string;
    league?: string;
    sport?: string;
    from?: string;
    to?: string;
    limit: number;
    userId?: string;
  }): Promise<FixtureOutcome> {
    const limit = clamp(params.limit, 1, 25);
    const key = this.cache.key('sports', {
      team: params.team ?? '',
      league: params.league ?? '',
      sport: params.sport ?? '',
      from: params.from ?? '',
      to: params.to ?? '',
      limit,
    });

    return this.run('sports', key, params.userId, this.registry.sportsChain(), async (p) => {
      const result = await p.fixtures({ ...params, limit });
      return { ...result, provider: p.id, cached: false };
    });
  }

  async fetchPage(params: {
    url: string;
    maxChars?: number;
    userId?: string;
  }): Promise<ExtractResult & { cached: boolean }> {
    const maxChars = clamp(params.maxChars ?? env().RESEARCH_MAX_PAGE_CHARS, 500, 40_000);
    const key = this.cache.key('extract', { url: params.url, maxChars });

    return this.run('extract', key, params.userId, this.registry.extractChain(), async (p) => {
      const result = await p.extract(params.url, maxChars);
      // An extractor that returns nothing has not succeeded; fall through to
      // the next one (that is what the Firecrawl fallback is for).
      if (!result.text.trim()) throw new Error('no readable content');
      return { ...result, cached: false };
    });
  }

  async weather(params: {
    place?: string;
    latitude?: number;
    longitude?: number;
    days: number;
    timezone?: string;
    userId?: string;
  }): Promise<WeatherReport & { cached: boolean }> {
    const days = clamp(params.days, 1, 16);
    const key = this.cache.key('weather', {
      place: params.place ?? '',
      lat: params.latitude ?? '',
      lon: params.longitude ?? '',
      days,
      tz: params.timezone ?? '',
    });

    return this.run(
      'weather',
      key,
      params.userId,
      this.registry.weatherChain(),
      async (p) => ({ ...(await p.forecast({ ...params, days })), cached: false }),
      // A forecast is stale quickly; cache it for minutes, not hours.
      env().RESEARCH_WEATHER_TTL_MINUTES,
    );
  }

  /**
   * Search, then read the most promising pages in full.
   *
   * This exists so a research question costs the agent **one** tool step
   * instead of one search plus N fetches: the model asks once, and gets
   * sources with real content and real citations back. `pages` comes from the
   * effort budget, so Light reads none and Deep reads several.
   */
  async brief(params: {
    q: string;
    limit: number;
    pages: number;
    freshnessDays?: number;
    userId?: string;
  }): Promise<BriefOutcome> {
    const found = await this.search(params);
    const providers = [found.provider];
    const unread: { url: string; reason: string }[] = [];

    const wanted = clamp(params.pages, 0, 5);
    if (!wanted) return { sources: found.sources, providers, unread };

    const sources = [...found.sources];
    // Sequential on purpose: the HTTP layer serialises per host anyway, and
    // reading three pages at once is how a research tool looks like a scraper.
    for (let i = 0; i < sources.length && i < wanted; i++) {
      try {
        const page = await this.fetchPage({ url: sources[i].url, userId: params.userId });
        sources[i] = {
          ...sources[i],
          title: sources[i].title || page.title || sources[i].url,
          publisher: sources[i].publisher ?? page.publisher,
          published_at: sources[i].published_at ?? page.published_at,
          content: page.text,
        };
        if (!providers.includes(page.provider)) providers.push(page.provider);
      } catch (err) {
        unread.push({
          url: sources[i].url,
          reason: err instanceof FetchRefused ? err.reason : shortMessage(err),
        });
      }
    }

    return { sources, providers, unread };
  }

  // ---- cache + chain ----------------------------------------------------

  /**
   * Try the cache, then each provider in turn.
   *
   * Usage is recorded for every attempt, including cache hits (as
   * `cached: true`), because "how often did we actually call out?" is the
   * question a quota readout has to answer.
   */
  private async run<P extends { id: string }, T extends { provider?: string; cached: boolean }>(
    kind: ProviderKind,
    cacheKey: string,
    userId: string | undefined,
    chain: P[],
    attempt: (provider: P) => Promise<T>,
    ttlMinutes?: number,
  ): Promise<T> {
    if (!chain.length) {
      throw new NoProvider(
        `No ${kind} provider is configured. Tell the user plainly that this ` +
          `capability is switched off rather than guessing an answer.`,
      );
    }

    // A chain that just failed completely is not retried: see
    // CHAIN_FAILURE_TTL_MS. The cache is still consulted first, because a
    // cached answer is valid whether or not the providers are reachable.
    const down = this.chainDown.get(kind);
    const stillDown = down && Date.now() - down.at < CHAIN_FAILURE_TTL_MS;

    const cached = await this.cache.get<T>(cacheKey);
    if (cached) {
      void this.cache.record({
        provider: (cached as { provider?: string }).provider ?? 'cache',
        kind,
        ok: true,
        cached: true,
        durationMs: 0,
        userId,
      });
      return { ...cached, cached: true };
    }

    if (stillDown && down) {
      throw new Error(
        `${kind} is unavailable: ${down.reason}. ` +
          `Do not retry this turn — it will fail the same way. Tell the user ` +
          `plainly that you could not look it up, and answer with what you have.`,
      );
    }

    const failures: string[] = [];

    for (const provider of chain) {
      const started = Date.now();
      try {
        const result = await attempt(provider);
        this.chainDown.delete(kind);
        await this.cache.record({
          provider: provider.id,
          kind,
          ok: true,
          durationMs: Date.now() - started,
          userId,
        });
        await this.cache.put({
          cacheKey,
          kind,
          provider: provider.id,
          payload: result,
          ttlMinutes,
        });
        return result;
      } catch (err) {
        const reason = err instanceof FetchRefused ? `${err.reason}: ${err.message}` : shortMessage(err);
        failures.push(`${provider.id} (${reason})`);
        // A success anywhere in the chain clears the memo; see below.
        this.logger.warn(`${kind} provider ${provider.id} failed — ${reason}`);
        await this.cache.record({
          provider: provider.id,
          kind,
          ok: false,
          durationMs: Date.now() - started,
          error: reason,
          userId,
        });
      }
    }

    const reason = failures.join('; ');
    this.chainDown.set(kind, { at: Date.now(), reason });
    throw new Error(
      `Every ${kind} provider failed: ${reason}. ` +
        `Do not retry this turn — the same call will fail again. Say plainly ` +
        `that you could not look it up, and answer with what you already have.`,
    );
  }
}

const clamp = (n: number, min: number, max: number): number =>
  Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), min), max) : min;

/**
 * Same page from two engines is one source. First occurrence wins.
 *
 * Exported for tests: metasearch and chain fallback both produce duplicates,
 * and a duplicated source is a citation that looks like corroboration.
 */
export function dedupe(sources: SourceDoc[]): SourceDoc[] {
  const seen = new Set<string>();
  const out: SourceDoc[] = [];

  for (const source of sources) {
    let key = source.url;
    try {
      const url = new URL(source.url);
      // Tracking parameters make the same page look like several.
      for (const param of [...url.searchParams.keys()]) {
        if (/^(utm_|fbclid|gclid|ref|ref_src|igshid)/i.test(param)) url.searchParams.delete(param);
      }
      key = `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`;
    } catch {
      // Not a parseable URL: fall back to the raw string.
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }

  return out;
}

const shortMessage = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).slice(0, 200);
