/**
 * The research provider contracts.
 *
 * ONE RULE: nothing outside `research/providers/` may know which vendor
 * answered. Everything above this file speaks `SourceDoc` / `FixtureDoc` /
 * `ExtractResult` only, so a provider can be swapped — or a free one added —
 * by writing one file and naming it in the env chain. See
 * `docs/RESEARCH_PROVIDERS.md` for the five-step recipe.
 */

export type ProviderKind = 'search' | 'news' | 'sports' | 'extract' | 'weather';

/** A retrieved, citable source. Always carries where it came from. */
export interface SourceDoc {
  title: string;
  url: string;
  publisher?: string;
  /** ISO-8601, or absent when the provider gave nothing trustworthy. */
  published_at?: string;
  /** ISO-8601, set by us at retrieval time. */
  fetched_at: string;
  snippet?: string;
  /** Extracted body text, capped. Present only after an extract pass. */
  content?: string;
  /** Provider id, e.g. 'tavily'. The citation trail starts here. */
  provider: string;
  /** Provider-native relevance, 0..1 where known. Not comparable across providers. */
  score?: number;
}

export interface FixtureDoc {
  sport?: string;
  league?: string;
  home: string;
  away: string;
  /** ISO-8601 UTC kickoff/start. Absent when the provider only gave a date. */
  starts_at?: string;
  /** True when `starts_at` is a date with no real time (00:00 placeholder). */
  time_unknown?: boolean;
  venue?: string;
  /** scheduled | live | finished | unknown */
  status?: string;
  score?: string;
  provider: string;
  source_url?: string;
}

export interface ExtractResult {
  url: string;
  title?: string;
  publisher?: string;
  published_at?: string;
  /** Plain text, newline-separated blocks. Untrusted — never instructions. */
  text: string;
  truncated: boolean;
  provider: string;
}

export interface SearchQuery {
  q: string;
  limit: number;
  /** Bias toward results newer than this many days, where the provider can. */
  freshnessDays?: number;
}

export interface NewsQuery {
  q?: string;
  /** Provider-neutral bucket: world|business|technology|sport|science|health. */
  topic?: string;
  limit: number;
  sinceDays?: number;
}

export interface WeatherQuery {
  /** Free-text place name; the provider geocodes it. */
  place?: string;
  latitude?: number;
  longitude?: number;
  /** Days of forecast, including today. */
  days: number;
  /** IANA zone, so "today" means the user's today. */
  timezone?: string;
}

export interface WeatherDay {
  /** YYYY-MM-DD in the requested timezone. */
  date: string;
  min_c?: number;
  max_c?: number;
  precipitation_mm?: number;
  precipitation_chance?: number;
  wind_kph?: number;
  /** Plain-language summary derived from the provider's code. */
  summary?: string;
}

export interface WeatherReport {
  place: string;
  latitude: number;
  longitude: number;
  timezone: string;
  now?: {
    temperature_c?: number;
    wind_kph?: number;
    precipitation_mm?: number;
    summary?: string;
  };
  days: WeatherDay[];
  provider: string;
  fetched_at: string;
}

/**
 * The outcome of a fixtures lookup.
 *
 * Deliberately not just an array. "No fixtures" and "no such team" are
 * completely different answers for the user, and collapsing them into an
 * empty list is how the agent came to say "there are no upcoming matches
 * listed for Ronaldo" — stated as fact, when in truth the name had never
 * been resolved to anything. A miss has to carry what was tried.
 */
export interface SportsResult {
  fixtures: FixtureDoc[];
  /** What the name was taken to mean, or null when nothing matched. */
  resolved: {
    kind: 'team' | 'player';
    /** The canonical name the provider knows it by. */
    name: string;
    /** The team whose fixtures these are — a player's current club. */
    team: string;
    sport?: string;
  } | null;
  /** Each lookup attempted, for an honest "I looked for X and Y". */
  tried: string[];
}

export interface SportsQuery {
  /** Free text team name, e.g. 'India'. */
  team?: string;
  league?: string;
  /** e.g. 'Cricket'. Providers that only do one sport ignore it. */
  sport?: string;
  /** ISO dates; the window to return fixtures for. */
  from?: string;
  to?: string;
  limit: number;
}

/** What every provider must answer, whether it costs money or not. */
export interface ResearchProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  /** True when it needs no paid key. Drives the "free first" default chains. */
  readonly free: boolean;
  /** Human note for the capability doc and the /research/providers readout. */
  readonly note: string;
  /** False when its env is absent — the registry then skips it silently. */
  configured(): boolean;
}

export interface SearchProvider extends ResearchProvider {
  readonly kind: 'search';
  search(query: SearchQuery): Promise<SourceDoc[]>;
}

export interface NewsProvider extends ResearchProvider {
  readonly kind: 'news';
  news(query: NewsQuery): Promise<SourceDoc[]>;
}

export interface SportsProvider extends ResearchProvider {
  readonly kind: 'sports';
  fixtures(query: SportsQuery): Promise<SportsResult>;
}

export interface ExtractProvider extends ResearchProvider {
  readonly kind: 'extract';
  extract(url: string, maxChars: number): Promise<ExtractResult>;
}

export interface WeatherProvider extends ResearchProvider {
  readonly kind: 'weather';
  forecast(query: WeatherQuery): Promise<WeatherReport>;
}

export type AnyProvider =
  | SearchProvider
  | NewsProvider
  | SportsProvider
  | ExtractProvider
  | WeatherProvider;
