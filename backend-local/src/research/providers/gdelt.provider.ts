import { env } from '../../config/env';
import type { ResearchHttpService } from '../http.service';
import type { NewsProvider, NewsQuery, SourceDoc } from '../provider.types';

/**
 * GDELT — free, keyless, no quota: a global index of news articles updated
 * every 15 minutes. Snippets are thin and the ranking is crude, but it is the
 * provider that keeps news working with no keys configured at all, so it sits
 * at the end of the news chain.
 */
export class GdeltProvider implements NewsProvider {
  readonly id = 'gdelt';
  readonly kind = 'news' as const;
  readonly free = true;
  readonly note =
    'Global news index. No key, no quota, but one request per 5s and slow to answer.';

  constructor(private readonly http: ResearchHttpService) {}

  configured(): boolean {
    return true;
  }

  async news(query: NewsQuery): Promise<SourceDoc[]> {
    // GDELT needs a query; a topic alone is not one.
    const q = (query.q ?? query.topic ?? '').trim();
    if (!q) return [];

    const data = await this.http.fetchJson<{
      articles?: {
        title?: string;
        url?: string;
        domain?: string;
        seendate?: string;
        sourcecountry?: string;
      }[];
    }>('https://api.gdeltproject.org/api/v2/doc/doc', {
      query: {
        query: `${q} sourcelang:english`,
        mode: 'ArtList',
        format: 'json',
        sort: 'datedesc',
        maxrecords: Math.min(query.limit, 25),
        timespan: `${Math.max(1, Math.min(query.sinceDays ?? 7, 365))}d`,
      },
      accept: 'application/json',
      // GDELT's own rule, stated in its 429 body. Breaking it earns a 429
      // that takes ten seconds to arrive, which then reads as a timeout.
      minHostGapMs: 5_500,
      timeoutMs: Math.max(env().RESEARCH_FETCH_TIMEOUT_MS, 25_000),
    });

    const fetched = new Date().toISOString();
    return (data.articles ?? [])
      .filter((a) => a.url && a.title)
      .slice(0, query.limit)
      .map((a) => ({
        title: a.title as string,
        url: a.url as string,
        publisher: a.domain,
        published_at: parseSeenDate(a.seendate),
        fetched_at: fetched,
        provider: this.id,
      }));
  }
}

/** GDELT stamps dates as `20261122T103000Z`, which Date.parse will not read. */
export function parseSeenDate(value?: string): string | undefined {
  if (!value) return undefined;
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) {
    const direct = Date.parse(value);
    return Number.isFinite(direct) ? new Date(direct).toISOString() : undefined;
  }
  const [, y, mo, d, h, mi, s] = m;
  const parsed = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
