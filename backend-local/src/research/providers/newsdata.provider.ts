import { env } from '../../config/env';
import type { ResearchHttpService } from '../http.service';
import type { NewsProvider, NewsQuery, SourceDoc } from '../provider.types';

/** NewsData.io — broad news aggregation with real publication dates. */
export class NewsDataProvider implements NewsProvider {
  readonly id = 'newsdata';
  readonly kind = 'news' as const;
  readonly free = false;
  readonly note = 'Aggregated news. Free tier: ~200 requests/day, 10 articles each.';

  constructor(private readonly http: ResearchHttpService) {}

  configured(): boolean {
    return Boolean(env().NEWSDATA_API_KEY);
  }

  async news(query: NewsQuery): Promise<SourceDoc[]> {
    const data = await this.http.fetchJson<{
      results?: {
        title?: string;
        link?: string;
        description?: string;
        pubDate?: string;
        source_id?: string;
        source_name?: string;
      }[];
    }>('https://newsdata.io/api/1/latest', {
      query: {
        apikey: env().NEWSDATA_API_KEY,
        q: query.q,
        category: category(query.topic),
        language: 'en',
        size: Math.min(query.limit, 10),
      },
      accept: 'application/json',
    });

    const fetched = new Date().toISOString();
    return (data.results ?? [])
      .filter((r) => r.link && r.title)
      .slice(0, query.limit)
      .map((r) => ({
        title: r.title as string,
        url: r.link as string,
        publisher: r.source_name ?? r.source_id,
        snippet: r.description?.slice(0, 600),
        // pubDate is "YYYY-MM-DD HH:mm:ss" in UTC, which Date.parse reads as
        // local time — so it is spelled out as UTC before parsing.
        published_at: isoOrUndefined(r.pubDate?.replace(' ', 'T').concat('Z')),
        fetched_at: fetched,
        provider: this.id,
      }));
  }
}

/** Our neutral topics mapped to NewsData's categories. */
function category(topic?: string): string | undefined {
  if (!topic) return undefined;
  const map: Record<string, string> = {
    world: 'world',
    business: 'business',
    technology: 'technology',
    sport: 'sports',
    sports: 'sports',
    science: 'science',
    health: 'health',
    politics: 'politics',
  };
  return map[topic.toLowerCase()];
}

function isoOrUndefined(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
