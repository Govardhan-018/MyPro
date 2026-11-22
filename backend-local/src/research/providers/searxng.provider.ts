import { env } from '../../config/env';
import type { ResearchHttpService } from '../http.service';
import type { SearchProvider, SearchQuery, SourceDoc } from '../provider.types';

/**
 * SearXNG — a free metasearch engine you point at an instance you trust
 * (ideally your own; a public one is rate-limited and may disable the JSON
 * API). No key, no quota, no account. This is the provider that keeps web
 * search working when a paid tier runs out.
 *
 * `SEARXNG_BASE_URL` must be an origin, e.g. `https://searx.example.org`.
 */
export class SearxngProvider implements SearchProvider {
  readonly id = 'searxng';
  readonly kind = 'search' as const;
  readonly free = true;
  readonly note = 'Self-hosted or public SearXNG instance. No key. Needs SEARXNG_BASE_URL.';

  constructor(private readonly http: ResearchHttpService) {}

  configured(): boolean {
    return Boolean(env().SEARXNG_BASE_URL);
  }

  async search(query: SearchQuery): Promise<SourceDoc[]> {
    const base = (env().SEARXNG_BASE_URL ?? '').replace(/\/+$/, '');

    const data = await this.http.fetchJson<{
      results?: {
        title?: string;
        url?: string;
        content?: string;
        publishedDate?: string;
        engine?: string;
        score?: number;
      }[];
    }>(`${base}/search`, {
      query: {
        q: query.q,
        format: 'json',
        language: 'en',
        safesearch: 1,
        // SearXNG has no day window; its time_range is coarse.
        time_range: timeRange(query.freshnessDays),
      },
      accept: 'application/json',
    });

    const fetched = new Date().toISOString();
    const seen = new Set<string>();

    return (data.results ?? [])
      .filter((r) => {
        if (!r.url || !r.title) return false;
        // Metasearch returns the same URL from several engines.
        if (seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      })
      .slice(0, query.limit)
      .map((r) => ({
        title: r.title as string,
        url: r.url as string,
        snippet: r.content?.slice(0, 600),
        published_at: isoOrUndefined(r.publishedDate),
        fetched_at: fetched,
        provider: this.id,
        score: typeof r.score === 'number' ? r.score : undefined,
      }));
  }
}

function timeRange(days?: number): string | undefined {
  if (!days) return undefined;
  if (days <= 1) return 'day';
  if (days <= 31) return 'month';
  return 'year';
}

function isoOrUndefined(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
