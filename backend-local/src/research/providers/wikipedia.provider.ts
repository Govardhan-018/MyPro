import type { ResearchHttpService } from '../http.service';
import type { SearchProvider, SearchQuery, SourceDoc } from '../provider.types';

/**
 * Wikipedia — free, keyless, and the last provider in the search chain. It
 * cannot answer "what happened today", but it reliably answers "what is X",
 * and it means the chain is never completely dead with no keys at all.
 *
 * ⚠️ **It is a floor, not a search engine.** Wikimedia rate-limits by IP and
 * user agent, and a shared cloud IP (Render, say) is often already deep into
 * someone else's budget — the first live run on Render got nothing but 429s.
 * Their user-agent policy asks for a descriptive agent with a contact, which
 * is what `RESEARCH_USER_AGENT` is for; setting it measurably reduces the
 * throttling. The real fix is a Brave or Tavily key ahead of this in the
 * chain, which is why both sit above it by default.
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
      headers: {
        // Wikimedia reads this in preference to User-Agent and throttles
        // anonymous-looking clients hardest. Same value either way, but
        // sending both is what their policy asks for.
        'Api-User-Agent': this.http.userAgent(),
      },
      // Their limits are per-IP and we share one with every other free
      // service on the host, so go gently.
      minHostGapMs: 2_000,
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
