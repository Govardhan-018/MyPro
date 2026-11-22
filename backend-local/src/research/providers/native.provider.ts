import { FetchRefused, type ResearchHttpService } from '../http.service';
import { extractArticle } from '../extract';
import type { ExtractProvider, ExtractResult } from '../provider.types';

/**
 * The default extractor: our own guarded fetch plus Cheerio.
 *
 * Free, no account, no quota, and it handles the large majority of pages —
 * news articles, documentation, blogs. It cannot run JavaScript, so a page
 * that renders client-side comes back thin; that is what the Firecrawl
 * fallback is for, and why `extract` reports what it got rather than
 * pretending.
 *
 * This is the only provider that fetches arbitrary, model-chosen URLs, so it
 * is the one that asks robots.txt first.
 */
export class NativeExtractProvider implements ExtractProvider {
  readonly id = 'native';
  readonly kind = 'extract' as const;
  readonly free = true;
  readonly note = 'Direct fetch + Cheerio. Free. No JavaScript rendering.';

  constructor(private readonly http: ResearchHttpService) {}

  configured(): boolean {
    return true;
  }

  async extract(url: string, maxChars: number): Promise<ExtractResult> {
    const res = await this.http.fetchText(url, { respectRobots: true });

    if (res.status < 200 || res.status >= 300) {
      throw new FetchRefused('http_status', `${res.status} from ${new URL(res.url).hostname}`);
    }

    const type = res.contentType.toLowerCase();

    // Plain text and markdown need no extraction.
    if (type.includes('text/plain') || type.includes('markdown')) {
      const text = res.body.slice(0, maxChars);
      return {
        url: res.url,
        text,
        truncated: res.truncated || res.body.length > maxChars,
        provider: this.id,
      };
    }

    if (type && !type.includes('html') && !type.includes('xml')) {
      throw new FetchRefused('unsupported_type', `${type || 'unknown type'} is not a web page`);
    }

    const extracted = extractArticle(res.body, res.url, { maxChars });
    return {
      url: res.url,
      title: extracted.title,
      publisher: extracted.publisher,
      published_at: extracted.published_at,
      text: extracted.text,
      // The byte cap and the character cap are both reasons it is partial.
      truncated: extracted.truncated || res.truncated,
      provider: this.id,
    };
  }
}
