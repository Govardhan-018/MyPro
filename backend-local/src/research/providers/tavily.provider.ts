import { env } from '../../config/env';
import type { ResearchHttpService } from '../http.service';
import type { SearchProvider, SearchQuery, SourceDoc } from '../provider.types';

/** Tavily — search built for LLM use: ranked, deduplicated, with snippets. */
export class TavilyProvider implements SearchProvider {
  readonly id = 'tavily';
  readonly kind = 'search' as const;
  readonly free = false;
  readonly note = 'Search API with LLM-shaped results. Free tier: ~1,000 credits/month.';

  constructor(private readonly http: ResearchHttpService) {}

  configured(): boolean {
    return Boolean(env().TAVILY_API_KEY);
  }

  async search(query: SearchQuery): Promise<SourceDoc[]> {
    const data = await this.http.fetchJson<{
      results?: {
        title?: string;
        url?: string;
        content?: string;
        score?: number;
        published_date?: string;
      }[];
    }>('https://api.tavily.com/search', {
      json: {
        api_key: env().TAVILY_API_KEY,
        query: query.q,
        max_results: query.limit,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false,
        ...(query.freshnessDays ? { days: query.freshnessDays } : {}),
      },
    });

    const fetched = new Date().toISOString();
    return (data.results ?? [])
      .filter((r) => r.url && r.title)
      .slice(0, query.limit)
      .map((r) => ({
        title: r.title as string,
        url: r.url as string,
        snippet: r.content?.slice(0, 600),
        published_at: isoOrUndefined(r.published_date),
        fetched_at: fetched,
        provider: this.id,
        score: typeof r.score === 'number' ? r.score : undefined,
      }));
  }
}

/** A date we cannot parse is dropped: a wrong date would be cited as fact. */
function isoOrUndefined(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
