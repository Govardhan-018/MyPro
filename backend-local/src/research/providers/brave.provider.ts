import { env } from '../../config/env';
import type { ResearchHttpService } from '../http.service';
import type { SearchProvider, SearchQuery, SourceDoc } from '../provider.types';

/** Brave Search — independent index, generous free tier, plain web results. */
export class BraveProvider implements SearchProvider {
  readonly id = 'brave';
  readonly kind = 'search' as const;
  readonly free = false;
  readonly note = 'Independent web index. Free tier: ~2,000 queries/month, 1 query/second.';

  constructor(private readonly http: ResearchHttpService) {}

  configured(): boolean {
    return Boolean(env().BRAVE_SEARCH_API_KEY);
  }

  async search(query: SearchQuery): Promise<SourceDoc[]> {
    const data = await this.http.fetchJson<{
      web?: {
        results?: {
          title?: string;
          url?: string;
          description?: string;
          age?: string;
          page_age?: string;
          profile?: { name?: string };
        }[];
      };
    }>('https://api.search.brave.com/res/v1/web/search', {
      query: {
        q: query.q,
        count: Math.min(query.limit, 20),
        // Brave's freshness buckets; anything finer is not offered.
        freshness: freshnessBucket(query.freshnessDays),
      },
      accept: 'application/json',
      headers: {
        'x-subscription-token': env().BRAVE_SEARCH_API_KEY ?? '',
        'accept-encoding': 'gzip',
      },
    });

    const fetched = new Date().toISOString();
    return (data.web?.results ?? [])
      .filter((r) => r.url && r.title)
      .slice(0, query.limit)
      .map((r) => ({
        title: r.title as string,
        url: r.url as string,
        publisher: r.profile?.name,
        snippet: r.description?.replace(/<[^>]+>/g, '').slice(0, 600),
        published_at: isoOrUndefined(r.page_age ?? r.age),
        fetched_at: fetched,
        provider: this.id,
      }));
  }
}

function freshnessBucket(days?: number): string | undefined {
  if (!days) return undefined;
  if (days <= 1) return 'pd';
  if (days <= 7) return 'pw';
  if (days <= 31) return 'pm';
  return 'py';
}

function isoOrUndefined(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
