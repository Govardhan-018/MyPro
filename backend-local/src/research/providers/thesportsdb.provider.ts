import { env } from '../../config/env';
import type { ResearchHttpService } from '../http.service';
import type { FixtureDoc, SportsProvider, SportsQuery } from '../provider.types';

/**
 * TheSportsDB — fixtures and results across sports, cricket included.
 *
 * Two calls: resolve the team name to an id, then ask for its upcoming and
 * recent events. `THESPORTSDB_API_KEY` has a public free test key (`3`) that
 * works without an account, which is why this provider is marked free: it
 * answers "when does India play next" with nothing configured.
 *
 * Kickoff times are the awkward part. The API gives `dateEvent` always and
 * `strTimestamp` usually; when there is no real time, the fixture is marked
 * `time_unknown` rather than being silently presented as midnight — a
 * calendar event at 00:00 that claims to be a match is worse than no event.
 */
export class TheSportsDbProvider implements SportsProvider {
  readonly id = 'thesportsdb';
  readonly kind = 'sports' as const;
  readonly free = true;
  readonly note =
    'Fixtures and results incl. cricket. Public test key (123) works; rate-limited.';

  constructor(private readonly http: ResearchHttpService) {}

  configured(): boolean {
    return true;
  }

  /**
   * `123` is TheSportsDB's current public test key. The older `3` was
   * permanently disabled — it answers 403 with a message saying so — which is
   * exactly the kind of thing that makes a hardcoded key a liability, hence
   * `THESPORTSDB_API_KEY`.
   */
  private base(): string {
    const key = env().THESPORTSDB_API_KEY || '123';
    return `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}`;
  }

  async fixtures(query: SportsQuery): Promise<FixtureDoc[]> {
    if (!query.team) return [];

    const team = await this.findTeam(query.team, query.sport);
    if (!team?.idTeam) return [];

    const [next, last] = await Promise.all([
      this.events(`${this.base()}/eventsnext.php`, team.idTeam),
      this.events(`${this.base()}/eventslast.php`, team.idTeam),
    ]);

    const from = query.from ? Date.parse(query.from) : undefined;
    const to = query.to ? Date.parse(query.to) : undefined;

    return [...next, ...last]
      .filter((fixture) => {
        if (!fixture.starts_at) return !from && !to;
        const at = Date.parse(fixture.starts_at);
        if (from !== undefined && Number.isFinite(from) && at < from) return false;
        if (to !== undefined && Number.isFinite(to) && at > to) return false;
        return true;
      })
      .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''))
      .slice(0, query.limit);
  }

  /**
   * Resolve a team name to an id.
   *
   * The trap: `searchteams.php?t=India` returns the **football** team and
   * nothing else, because TheSportsDB names national sides by sport — the
   * cricket team is "India Cricket", the rugby side "India Rugby". Asking
   * for India's cricket fixtures therefore returned nothing at all until
   * this retried with the sport appended, which is the naming convention
   * rather than a guess.
   */
  private async findTeam(
    name: string,
    sport?: string,
  ): Promise<{ idTeam?: string; strTeam?: string; strSport?: string } | undefined> {
    const search = async (term: string) => {
      const res = await this.http
        .fetchJson<{ teams?: { idTeam?: string; strTeam?: string; strSport?: string }[] }>(
          `${this.base()}/searchteams.php`,
          { query: { t: term }, accept: 'application/json' },
        )
        .catch(() => ({ teams: [] }));
      return res.teams ?? [];
    };

    const wanted = sport?.toLowerCase();
    const inSport = (list: { strSport?: string }[]) =>
      wanted ? list.find((t) => t.strSport?.toLowerCase() === wanted) : list[0];

    const direct = inSport(await search(name));
    if (direct) return direct;

    // National sides are named by sport: "India" is the football team, the
    // cricket side is "India Cricket".
    if (sport) {
      const bySport = inSport(await search(`${name} ${sport}`));
      if (bySport) return bySport;
    }

    // Still nothing? It may be a person. "When is Ronaldo's next match" is
    // a perfectly ordinary question that a team search can never answer,
    // and answering "no upcoming matches" to it is worse than useless —
    // it reads as fact rather than as a failed lookup.
    return this.teamOfPlayer(name, sport);
  }

  /** The club a player currently plays for, via TheSportsDB's player search. */
  private async teamOfPlayer(
    name: string,
    sport?: string,
  ): Promise<{ idTeam?: string; strTeam?: string; strSport?: string } | undefined> {
    const res = await this.http
      .fetchJson<{
        player?: { strPlayer?: string; strTeam?: string; strSport?: string; idTeam?: string }[];
      }>(`${this.base()}/searchplayers.php`, { query: { p: name }, accept: 'application/json' })
      .catch(() => ({ player: null }));

    const players = res.player ?? [];
    const wanted = sport?.toLowerCase();
    const player =
      (wanted ? players.find((p) => p.strSport?.toLowerCase() === wanted) : players[0]) ??
      players[0];
    if (!player?.strTeam) return undefined;

    // The player record carries the team name; resolve it to an id the
    // events endpoints will accept.
    const teams = await this.http
      .fetchJson<{ teams?: { idTeam?: string; strTeam?: string; strSport?: string }[] }>(
        `${this.base()}/searchteams.php`,
        { query: { t: player.strTeam }, accept: 'application/json' },
      )
      .catch(() => ({ teams: [] }));

    return (teams.teams ?? [])[0];
  }

  private async events(url: string, teamId: string): Promise<FixtureDoc[]> {
    type EventsResponse = {
      events?: SportsDbEvent[];
      /** `eventslast.php` answers under `results`, not `events`. */
      results?: unknown;
    };

    const data: EventsResponse = await this.http
      .fetchJson<{
        events?: {
          idEvent?: string;
          strEvent?: string;
          strHomeTeam?: string;
          strAwayTeam?: string;
          strLeague?: string;
          strSport?: string;
          strVenue?: string;
          strStatus?: string;
          dateEvent?: string;
          strTime?: string;
          strTimestamp?: string;
          intHomeScore?: string | null;
          intAwayScore?: string | null;
        }[];
        results?: unknown;
      }>(url, { query: { id: teamId }, accept: 'application/json' })
      .catch((): EventsResponse => ({ events: [] }));

    const rows = (data.events ??
      (Array.isArray(data.results) ? data.results : [])) as SportsDbEvent[];

    return rows
      .filter((e) => e.strHomeTeam && e.strAwayTeam)
      .map((e) => {
        const timed = timestampOf(e.strTimestamp, e.dateEvent, e.strTime);
        const home = e.intHomeScore;
        const away = e.intAwayScore;

        return {
          sport: e.strSport ?? undefined,
          league: e.strLeague ?? undefined,
          home: e.strHomeTeam as string,
          away: e.strAwayTeam as string,
          starts_at: timed?.iso,
          time_unknown: timed?.dateOnly,
          venue: e.strVenue ?? undefined,
          status: status(e.strStatus, timed?.iso),
          score:
            home != null && away != null && home !== '' && away !== ''
              ? `${home}-${away}`
              : undefined,
          provider: this.id,
          source_url: e.idEvent
            ? `https://www.thesportsdb.com/event/${encodeURIComponent(e.idEvent)}`
            : undefined,
        };
      });
  }
}

/** The subset of TheSportsDB's event shape we read. */
interface SportsDbEvent {
  idEvent?: string;
  strEvent?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  strLeague?: string;
  strSport?: string;
  strVenue?: string;
  strStatus?: string;
  dateEvent?: string;
  strTime?: string;
  strTimestamp?: string;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
}

/** Prefer the real timestamp; fall back to the date, flagged as time-unknown. */
export function timestampOf(
  stamp?: string,
  date?: string,
  time?: string,
): { iso: string; dateOnly: boolean } | undefined {
  if (stamp) {
    // Usually "2026-11-22 09:30:00" in UTC, which Date.parse would read local.
    const normalised = /z|[+-]\d{2}:?\d{2}$/i.test(stamp)
      ? stamp
      : `${stamp.replace(' ', 'T')}Z`;
    const parsed = Date.parse(normalised);
    if (Number.isFinite(parsed)) return { iso: new Date(parsed).toISOString(), dateOnly: false };
  }

  if (!date) return undefined;

  const hasTime = Boolean(time && /^\d{2}:\d{2}/.test(time) && !time.startsWith('00:00'));
  const parsed = Date.parse(hasTime ? `${date}T${(time as string).slice(0, 8)}Z` : `${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return undefined;

  return { iso: new Date(parsed).toISOString(), dateOnly: !hasTime };
}

function status(raw: string | undefined, startsAt: string | undefined): string {
  const value = (raw ?? '').trim().toUpperCase();
  if (['FT', 'AOT', 'FINISHED', 'MATCH FINISHED'].includes(value)) return 'finished';
  if (['1H', '2H', 'HT', 'LIVE', 'IN PLAY'].includes(value)) return 'live';
  if (['POSTP', 'POSTPONED'].includes(value)) return 'postponed';
  if (['CANC', 'CANCELLED'].includes(value)) return 'cancelled';
  if (!startsAt) return 'unknown';
  return Date.parse(startsAt) > Date.now() ? 'scheduled' : 'finished';
}
