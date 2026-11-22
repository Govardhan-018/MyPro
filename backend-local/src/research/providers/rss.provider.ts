import { env } from '../../config/env';
import type { ResearchHttpService } from '../http.service';
import type { NewsProvider, NewsQuery, SourceDoc } from '../provider.types';

/**
 * News from RSS/Atom feeds you choose — free, keyless, and reliable in a way
 * the open news APIs are not.
 *
 * This exists because GDELT, the only keyless news API worth having, rate
 * limits hard enough to fail in practice (one request per five seconds, and
 * a 429 that takes ten seconds to arrive). A feed you nominate has no quota,
 * no key, and no opinion about how often you read it.
 *
 * You supply the feeds in `NEWS_RSS_FEEDS`, comma-separated. Nothing is
 * hardcoded on purpose: whose news this is should be your decision, not a
 * default buried in a provider.
 *
 * Feeds are not searchable, so the query is applied as a filter over recent
 * items. That makes this strong for "what is happening with X" when X is in
 * your feeds' beat, and weak for anything else — which is why it sits beside
 * the API providers rather than replacing them.
 */
export class RssProvider implements NewsProvider {
  readonly id = 'rss';
  readonly kind = 'news' as const;
  readonly free = true;
  readonly note = 'RSS/Atom feeds you nominate. No key, no quota. Needs NEWS_RSS_FEEDS.';

  constructor(private readonly http: ResearchHttpService) {}

  configured(): boolean {
    return this.feeds().length > 0;
  }

  private feeds(): string[] {
    return (env().NEWS_RSS_FEEDS ?? '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  async news(query: NewsQuery): Promise<SourceDoc[]> {
    const terms = (query.q ?? query.topic ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2);

    const since = query.sinceDays
      ? Date.now() - query.sinceDays * 86_400_000
      : Number.NEGATIVE_INFINITY;

    const fetched = new Date().toISOString();
    const out: SourceDoc[] = [];
    const failures: string[] = [];

    // Sequential: the HTTP layer serialises per host anyway, and a handful of
    // feeds is not worth the concurrency.
    for (const feed of this.feeds()) {
      try {
        const res = await this.http.fetchText(feed, {
          accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
          maxBytes: 1_000_000,
        });
        if (res.status < 200 || res.status >= 300) {
          failures.push(`${hostOf(feed)} (${res.status})`);
          continue;
        }
        out.push(...parseFeed(res.body, fetched, this.id));
      } catch (err) {
        failures.push(`${hostOf(feed)} (${err instanceof Error ? err.message : 'failed'})`);
      }
    }

    // Every feed down is a failure worth reporting, so the chain moves on.
    if (!out.length && failures.length) {
      throw new Error(`no feed could be read: ${failures.join('; ')}`);
    }

    return out
      .filter((item) => {
        if (!terms.length) return true;
        const haystack = `${item.title} ${item.snippet ?? ''}`.toLowerCase();
        // Every word, not any: "india cricket" should not match every cricket
        // story in a feed that also covers India.
        return terms.every((term) => haystack.includes(term));
      })
      .filter((item) => !item.published_at || Date.parse(item.published_at) >= since)
      .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
      .slice(0, query.limit);
  }
}

/**
 * A deliberately small RSS/Atom reader.
 *
 * No XML library: feeds are a fixed, simple shape and the alternative is a
 * dependency that parses untrusted XML, which is a larger attack surface
 * (entity expansion, external entities) than the problem deserves. Exported
 * for tests.
 */
export function parseFeed(xml: string, fetchedAt: string, provider: string): SourceDoc[] {
  const items = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);

  const out: SourceDoc[] = [];

  for (const item of items) {
    const title = decode(tag(item, 'title'));
    const link = decode(tag(item, 'link')) || attr(item, 'link', 'href');
    const published =
      tag(item, 'pubDate') || tag(item, 'published') || tag(item, 'updated') || tag(item, 'dc:date');
    const summary = decode(tag(item, 'description') || tag(item, 'summary'));

    if (!title || !link) continue;

    const parsed = published ? Date.parse(published) : Number.NaN;
    out.push({
      title: title.slice(0, 300),
      url: link,
      publisher: hostOf(link),
      published_at: Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined,
      snippet: summary ? strip(summary).slice(0, 400) : undefined,
      fetched_at: fetchedAt,
      provider,
    });
  }

  return out;
}

/** First occurrence of a tag's text content, CDATA unwrapped. */
function tag(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!match) return '';
  return match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i, '$1').trim();
}

/** An attribute of a self-closing tag, which is how Atom writes its links. */
function attr(xml: string, name: string, attribute: string): string {
  const match = xml.match(new RegExp(`<${name}\\b[^>]*\\b${attribute}="([^"]+)"`, 'i'));
  return match ? match[1] : '';
}

const strip = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Ampersand last, or the entities above would be re-decoded from it.
    .replace(/&amp;/g, '&')
    .trim();
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}
