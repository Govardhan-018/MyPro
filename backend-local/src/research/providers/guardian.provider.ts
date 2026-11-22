import { env } from '../../config/env';
import type { ResearchHttpService } from '../http.service';
import type { NewsProvider, NewsQuery, SourceDoc } from '../provider.types';

/**
 * The Guardian — one publisher rather than an aggregator, but its open API is
 * generous (12,000 calls/day), dated precisely, and includes the trail text,
 * so a citation needs no page fetch. Strong on cricket, which matters here.
 */
export class GuardianProvider implements NewsProvider {
  readonly id = 'guardian';
  readonly kind = 'news' as const;
  readonly free = false;
  readonly note = 'Single publisher, open API. Free developer key: ~12,000 calls/day.';

  constructor(private readonly http: ResearchHttpService) {}

  configured(): boolean {
    return Boolean(env().GUARDIAN_API_KEY);
  }

  async news(query: NewsQuery): Promise<SourceDoc[]> {
    const since = query.sinceDays
      ? new Date(Date.now() - query.sinceDays * 86_400_000).toISOString().slice(0, 10)
      : undefined;

    const data = await this.http.fetchJson<{
      response?: {
        results?: {
          webTitle?: string;
          webUrl?: string;
          webPublicationDate?: string;
          sectionName?: string;
          fields?: { trailText?: string; byline?: string };
        }[];
      };
    }>('https://content.guardianapis.com/search', {
      query: {
        'api-key': env().GUARDIAN_API_KEY,
        q: query.q,
        section: section(query.topic),
        'from-date': since,
        'order-by': 'newest',
        'show-fields': 'trailText,byline',
        'page-size': Math.min(query.limit, 20),
      },
      accept: 'application/json',
    });

    const fetched = new Date().toISOString();
    return (data.response?.results ?? [])
      .filter((r) => r.webUrl && r.webTitle)
      .slice(0, query.limit)
      .map((r) => ({
        title: r.webTitle as string,
        url: r.webUrl as string,
        publisher: 'The Guardian',
        snippet: r.fields?.trailText?.replace(/<[^>]+>/g, '').slice(0, 600),
        published_at: isoOrUndefined(r.webPublicationDate),
        fetched_at: fetched,
        provider: this.id,
      }));
  }
}

function section(topic?: string): string | undefined {
  if (!topic) return undefined;
  const map: Record<string, string> = {
    world: 'world',
    business: 'business',
    technology: 'technology',
    sport: 'sport',
    sports: 'sport',
    science: 'science',
    health: 'society',
    politics: 'politics',
  };
  return map[topic.toLowerCase()];
}

function isoOrUndefined(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
