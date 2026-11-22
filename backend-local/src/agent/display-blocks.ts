/**
 * Turning a turn's tool results into things the screen can render. Pure.
 *
 * The problem this solves, from a real session: asked for the latest cricket
 * news, the agent replied with an unbroken paragraph containing a team's
 * all-time Test record, ODI record, and T20 record. Everything in it came
 * from a tool result — titles, dates, numbers — and all of it arrived as
 * prose, because prose was the only thing the model had to put it in.
 *
 * The obvious fix is to ask the model for JSON. This does the opposite, for
 * two reasons:
 *
 *  - **The data is already structured.** It came back from a provider as
 *    fields. Asking a model to retype it into JSON spends tokens to make it
 *    *less* reliable, and invites a parse failure that costs the whole reply.
 *  - **A model can invent a citation; a tool result cannot.** Blocks built
 *    from what the tools actually returned cannot show a source that was
 *    never fetched, which is the one guarantee worth having here.
 *
 * So the model keeps writing prose, and is told in the system prompt not to
 * retype what it can see will be rendered. The cards come from here.
 */

export type DisplayBlock =
  | {
      kind: 'sources';
      /** Which capability produced them, so the UI can label honestly. */
      from: string;
      items: {
        title: string;
        url: string;
        publisher?: string;
        published_at?: string;
        snippet?: string;
      }[];
    }
  | {
      kind: 'fixtures';
      from: string;
      /** What the name was taken to mean. Absent when it did not resolve. */
      resolved?: { kind: string; name: string; team: string; sport?: string };
      items: {
        home: string;
        away: string;
        starts_at?: string;
        /** No confirmed kickoff; the UI must not render midnight as a time. */
        time_unknown?: boolean;
        venue?: string;
        status?: string;
        score?: string;
        league?: string;
      }[];
    }
  | {
      kind: 'weather';
      from: string;
      place: string;
      timezone?: string;
      now?: { temperature_c?: number; summary?: string; wind_kph?: number };
      days: {
        date: string;
        min_c?: number;
        max_c?: number;
        precipitation_chance?: number;
        summary?: string;
      }[];
    };

/** One tool result, as the executor saw it. */
export interface ToolOutput {
  name: string;
  /** The JSON string handed back to the model. */
  content: string;
}

/** Keep a card readable: beyond this it is a database dump, not an answer. */
const MAX_ITEMS = 6;

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

function parse(content: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(content);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    // Tool results are JSON by construction, but an error string is a
    // perfectly ordinary result and is simply not renderable.
    return null;
  }
}

const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as Record<string, unknown>[]) : [];

/**
 * Build the renderable blocks for one turn.
 *
 * Only capabilities whose output has a genuine shape are handled; everything
 * else stays prose, which is the right default. A capability that returns
 * nothing worth showing produces no block rather than an empty card.
 */
export function buildBlocks(outputs: readonly ToolOutput[]): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];

  for (const output of outputs) {
    const data = parse(output.content);
    if (!data) continue;

    switch (output.name) {
      case 'web_search':
      case 'news_search': {
        const items = rows(data.sources ?? data.articles)
          .map((s) => ({
            title: str(s.title) ?? '',
            url: str(s.url) ?? '',
            publisher: str(s.publisher),
            published_at: str(s.published_at),
            snippet: str(s.snippet)?.slice(0, 220),
          }))
          .filter((s) => s.title && s.url)
          .slice(0, MAX_ITEMS);
        if (items.length) blocks.push({ kind: 'sources', from: output.name, items });
        break;
      }

      case 'fetch_page': {
        const url = str(data.url);
        const title = str(data.title);
        if (url) {
          blocks.push({
            kind: 'sources',
            from: output.name,
            items: [
              {
                title: title ?? url,
                url,
                publisher: str(data.publisher),
                published_at: str(data.published_at),
              },
            ],
          });
        }
        break;
      }

      case 'sports_fixtures': {
        const items = rows(data.fixtures)
          .map((f) => ({
            home: str(f.home) ?? '',
            away: str(f.away) ?? '',
            starts_at: str(f.starts_at),
            time_unknown: f.time_unknown === true,
            venue: str(f.venue),
            status: str(f.status),
            score: str(f.score),
            league: str(f.league),
          }))
          .filter((f) => f.home && f.away)
          .slice(0, MAX_ITEMS);

        if (items.length) {
          const resolved = data.resolved as Record<string, unknown> | undefined;
          blocks.push({
            kind: 'fixtures',
            from: output.name,
            resolved:
              resolved && str(resolved.team)
                ? {
                    kind: str(resolved.kind) ?? 'team',
                    name: str(resolved.name) ?? '',
                    team: str(resolved.team) ?? '',
                    sport: str(resolved.sport),
                  }
                : undefined,
            items,
          });
        }
        break;
      }

      case 'get_weather': {
        const place = str(data.place);
        const days = rows(data.days)
          .map((d) => ({
            date: str(d.date) ?? '',
            min_c: num(d.min_c),
            max_c: num(d.max_c),
            precipitation_chance: num(d.precipitation_chance),
            summary: str(d.summary),
          }))
          .filter((d) => d.date)
          .slice(0, 7);

        if (place && days.length) {
          const current = data.now as Record<string, unknown> | undefined;
          blocks.push({
            kind: 'weather',
            from: output.name,
            place,
            timezone: str(data.timezone),
            now: current
              ? {
                  temperature_c: num(current.temperature_c),
                  summary: str(current.summary),
                  wind_kph: num(current.wind_kph),
                }
              : undefined,
            days,
          });
        }
        break;
      }

      default:
        // Everything else is prose. Most results are a confirmation or a
        // short list the model says better in a sentence than a card does.
        break;
    }
  }

  return blocks;
}

/**
 * What the model is told about the blocks, so it stops retyping them.
 *
 * Without this the user sees the same five headlines twice — once as cards
 * and once paraphrased in the paragraph above them.
 */
export function blocksNote(blocks: readonly DisplayBlock[]): string {
  if (!blocks.length) return '';

  const described = blocks.map((block) => {
    switch (block.kind) {
      case 'sources':
        return `${block.items.length} source(s) with their titles, links and dates`;
      case 'fixtures':
        return `${block.items.length} fixture(s) with teams, dates and venues`;
      case 'weather':
        return `the forecast for ${block.place}`;
    }
  });

  return [
    'ALREADY ON SCREEN (do not repeat it)',
    `The app is showing the user, as cards beneath your reply: ${described.join('; ')}.`,
    'So do not list them, do not paraphrase them one by one, and do not restate dates or',
    'links they can already see. Give the takeaway in a sentence or two — what it means,',
    'what stands out, what you would do about it — and stop.',
  ].join('\n');
}
