import { env } from '../../config/env';
import type { ResearchHttpService } from '../http.service';
import type { ExtractProvider, ExtractResult } from '../provider.types';

/**
 * Firecrawl — hosted scraping, used only as the fallback when our own fetch
 * comes back empty or blocked (a JavaScript-rendered page, or a site that
 * refuses plain clients).
 *
 * It is last in the chain on purpose: it costs credits, and it does the
 * fetching on someone else's infrastructure, which means our SSRF guard is
 * not in the path. The URL is still vetted locally before being handed over,
 * but a hosted scraper can reach places we would refuse to — so it is opt-in
 * by key, and never the first thing tried.
 */
export class FirecrawlProvider implements ExtractProvider {
  readonly id = 'firecrawl';
  readonly kind = 'extract' as const;
  readonly free = false;
  readonly note = 'Hosted scraping with JS rendering. Fallback only; costs credits.';

  constructor(private readonly http: ResearchHttpService) {}

  configured(): boolean {
    return Boolean(env().FIRECRAWL_API_KEY);
  }

  async extract(url: string, maxChars: number): Promise<ExtractResult> {
    const data = await this.http.fetchJson<{
      success?: boolean;
      data?: {
        markdown?: string;
        metadata?: {
          title?: string;
          sourceURL?: string;
          publishedTime?: string;
          ogSiteName?: string;
        };
      };
      error?: string;
    }>('https://api.firecrawl.dev/v1/scrape', {
      json: { url, formats: ['markdown'], onlyMainContent: true },
      headers: { authorization: `Bearer ${env().FIRECRAWL_API_KEY ?? ''}` },
      accept: 'application/json',
      // The hosted fetch is slower than ours; it is the fallback, so wait.
      timeoutMs: Math.max(env().RESEARCH_FETCH_TIMEOUT_MS, 30_000),
    });

    if (!data.data?.markdown) {
      throw new Error(data.error || 'firecrawl returned no content');
    }

    const markdown = data.data.markdown;
    const published = data.data.metadata?.publishedTime;
    const parsed = published ? Date.parse(published) : Number.NaN;

    return {
      url: data.data.metadata?.sourceURL ?? url,
      title: data.data.metadata?.title,
      publisher: data.data.metadata?.ogSiteName,
      published_at: Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined,
      text: markdown.slice(0, maxChars),
      truncated: markdown.length > maxChars,
      provider: this.id,
    };
  }
}
