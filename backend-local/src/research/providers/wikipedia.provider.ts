import type { ResearchHttpService } from '../http.service';
import type { SearchProvider, SearchQuery, SourceDoc } from '../provider.types';

/**
 * Wikipedia — free, keyless, no quota, and the last provider in the search
 * chain. It cannot answer "what happened today", but it reliably answers
 * "what is X", which is a large share of what gets asked, and it means the
 * chain is never completely dead with no keys configured at all.
 */
export class WikipediaProvider implements SearchProvider {
  readonly id = 'wikipedia';
  readonly kind = 'search' as const;
  readonly free = true;
  readonly note = 'Encyclopaedic lookup. No key, no quota. Weak on current events.';

  constructor(private readonly http: ResearchHttpService) {}

  /** Nothing to configure, so it is always available. */
  configured(): boolean {
    return true;
  }

  async search(query: SearchQuery): Promise<SourceDoc[]> {
    const data = await this.http.fetchJson<{
      query?: {
        search?: { title?: string; snippet?: string; timestamp?: string }[];
      };
    }>('https://en.wikipedia.org/w/api.php', {
      query: {
        action: 'query',
        list: 'search',
        srsearch: query.q,
        srlimit: Math.min(query.limit, 10),
        format: 'json',
        formatversion: 2,
      },
      accept: 'application/json',
    });

    const fetched = new Date().toISOString();
    return (data.query?.search ?? [])
      .filter((r) => r.title)
      .slice(0, query.limit)
      .map((r) => ({
        title: r.title as string,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent((r.title as string).replace(/ /g, '_'))}`,
        publisher: 'Wikipedia',
        // The API returns HTML search highlighting.
        snippet: r.snippet?.replace(/<[^>]+>/g, '').slice(0, 600),
        // This is the last-edited time, not a publication date — useful, but
        // it is not "when this was published", so it is not presented as one.
        fetched_at: fetched,
        provider: this.id,
      }));
  }
}
