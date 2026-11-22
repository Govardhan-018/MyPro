import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { ResearchHttpService } from './http.service';
import type {
  AnyProvider,
  ExtractProvider,
  NewsProvider,
  ProviderKind,
  SearchProvider,
  SportsProvider,
  WeatherProvider,
} from './provider.types';
import { TavilyProvider } from './providers/tavily.provider';
import { BraveProvider } from './providers/brave.provider';
import { SearxngProvider } from './providers/searxng.provider';
import { WikipediaProvider } from './providers/wikipedia.provider';
import { NewsDataProvider } from './providers/newsdata.provider';
import { GuardianProvider } from './providers/guardian.provider';
import { GdeltProvider } from './providers/gdelt.provider';
import { RssProvider } from './providers/rss.provider';
import { TheSportsDbProvider } from './providers/thesportsdb.provider';
import { NativeExtractProvider } from './providers/native.provider';
import { FirecrawlProvider } from './providers/firecrawl.provider';
import { OpenMeteoProvider } from './providers/openmeteo.provider';

/**
 * The provider registry: which service answers, in what order.
 *
 * Chains are resolved from env so a provider can be added, reordered or
 * dropped without touching anything above this file. Leave the env blank and
 * the built-in order stands, filtered to whatever is actually configured —
 * so adding a key is enough, and declaring an order is optional.
 *
 * The default order puts paid-and-better first *where a key exists* and ends
 * every chain with a free, keyless provider, so research degrades instead of
 * dying when a quota runs out. With nothing configured at all, search still
 * answers (Wikipedia), news still answers (GDELT), fixtures still answer
 * (TheSportsDB's public test key) and weather still answers (Open-Meteo).
 *
 * An unknown name in an env chain is logged and skipped. A typo must never
 * stop the agent from booting.
 */

const DEFAULT_CHAINS: Readonly<Record<ProviderKind, readonly string[]>> = {
  search: ['tavily', 'brave', 'searxng', 'wikipedia'],
  news: ['guardian', 'newsdata', 'rss', 'gdelt'],
  sports: ['thesportsdb'],
  extract: ['native', 'firecrawl'],
  weather: ['open-meteo'],
};

@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly byId: ReadonlyMap<string, AnyProvider>;

  constructor(http: ResearchHttpService) {
    const all: AnyProvider[] = [
      new TavilyProvider(http),
      new BraveProvider(http),
      new SearxngProvider(http),
      new WikipediaProvider(http),
      new GuardianProvider(http),
      new NewsDataProvider(http),
      new RssProvider(http),
      new GdeltProvider(http),
      new TheSportsDbProvider(http),
      new NativeExtractProvider(http),
      new FirecrawlProvider(http),
      new OpenMeteoProvider(http),
    ];
    this.byId = new Map(all.map((p) => [p.id, p]));
  }

  searchChain(): SearchProvider[] {
    return this.chain('search') as SearchProvider[];
  }
  newsChain(): NewsProvider[] {
    return this.chain('news') as NewsProvider[];
  }
  sportsChain(): SportsProvider[] {
    return this.chain('sports') as SportsProvider[];
  }
  extractChain(): ExtractProvider[] {
    return this.chain('extract') as ExtractProvider[];
  }
  weatherChain(): WeatherProvider[] {
    return this.chain('weather') as WeatherProvider[];
  }

  /** Configured providers for a kind, in the order they should be tried. */
  chain(kind: ProviderKind): AnyProvider[] {
    const declared = this.declared(kind);
    const names = declared.length ? declared : [...DEFAULT_CHAINS[kind]];

    const chain = names
      .map((name) => this.byId.get(name))
      .filter((p): p is AnyProvider => Boolean(p) && p!.kind === kind)
      .filter((p) => p.configured());

    // A declared chain whose every entry is unconfigured would leave the
    // capability dead; fall back to whatever the defaults can still offer.
    if (!chain.length && declared.length) {
      return DEFAULT_CHAINS[kind]
        .map((name) => this.byId.get(name))
        .filter((p): p is AnyProvider => Boolean(p) && p!.kind === kind)
        .filter((p) => p.configured());
    }

    return chain;
  }

  /** What is available, for `GET /assistant/capabilities` and the docs. */
  readout(): {
    kind: ProviderKind;
    active: { id: string; free: boolean; note: string }[];
    inactive: string[];
  }[] {
    return (Object.keys(DEFAULT_CHAINS) as ProviderKind[]).map((kind) => {
      const active = this.chain(kind);
      const activeIds = new Set(active.map((p) => p.id));
      return {
        kind,
        active: active.map((p) => ({ id: p.id, free: p.free, note: p.note })),
        inactive: [...this.byId.values()]
          .filter((p) => p.kind === kind && !activeIds.has(p.id))
          .map((p) => p.id),
      };
    });
  }

  /** The env-declared order for a kind, names normalised. */
  private declared(kind: ProviderKind): string[] {
    const raw = {
      search: env().RESEARCH_SEARCH_PROVIDERS,
      news: env().RESEARCH_NEWS_PROVIDERS,
      sports: env().RESEARCH_SPORTS_PROVIDERS,
      extract: env().RESEARCH_EXTRACT_PROVIDERS,
      weather: env().RESEARCH_WEATHER_PROVIDERS,
    }[kind];

    if (!raw) return [];

    const names = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const unknown = names.filter((name) => {
      const provider = this.byId.get(name);
      return !provider || provider.kind !== kind;
    });
    if (unknown.length) {
      this.logger.warn(
        `RESEARCH_${kind.toUpperCase()}_PROVIDERS names unknown ${kind} provider(s): ` +
          `${unknown.join(', ')} — skipped`,
      );
    }

    return names;
  }
}
