import { env } from '../../config/env';
import type { ResearchHttpService } from '../http.service';
import type {
  FixtureDoc,
  SportsProvider,
  SportsQuery,
  SportsResult,
} from '../provider.types';

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
/**
 * The free key is throttled, and a 429 here is worse than slow: it used to
 * arrive as an empty list and be read as "no such team".
 */
const HOST_GAP_MS = 1_500;

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

  async fixtures(query: SportsQuery): Promise<SportsResult> {
    const tried: string[] = [];
    if (!query.team) return { fixtures: [], resolved: null, tried };

    const resolved = await this.resolve(query.team, query.sport, tried);
    if (!resolved) return { fixtures: [], resolved: null, tried };

    const [next, last] = await Promise.all([
      this.events(`${this.base()}/eventsnext.php`, resolved.teamId),
      this.events(`${this.base()}/eventslast.php`, resolved.teamId),
    ]);

    const from = query.from ? Date.parse(query.from) : undefined;
    const to = query.to ? Date.parse(query.to) : undefined;

    const fixtures = [...next, ...last]
      .filter((fixture) => {
        if (!fixture.starts_at) return !from && !to;
        const at = Date.parse(fixture.starts_at);
        if (from !== undefined && Number.isFinite(from) && at < from) return false;
        if (to !== undefined && Number.isFinite(to) && at > to) return false;
        return true;
      })
      .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''))
      .slice(0, query.limit);

    return {
      fixtures,
      resolved: {
        kind: resolved.kind,
        name: resolved.name,
        team: resolved.team,
        sport: resolved.sport,
      },
      tried,
    };
  }

  /**
   * Turn a name into a team whose fixtures can be read.
   *
   * A general ladder, not a list of special cases — every step is driven by
   * what the provider returns, so it works for any name the catalogue knows:
   *
   *   1. the name as a team
   *   2. the name plus the sport, because national sides are catalogued that
   *      way ("<country> <sport>"), so a bare country name resolves to
   *      whichever sport happens to be listed first
   *   3. the name as a *person*, taking the club id straight off the player
   *      record — the record's own team NAME often does not match any team
   *      search, so following the id is both more reliable and one call
   *      cheaper
   *
   * Every attempt is recorded in `tried`, so a miss can say what it looked
   * for instead of asserting that no matches exist.
   */
  private async resolve(
    name: string,
    sport: string | undefined,
    tried: string[],
  ): Promise<
    { kind: 'team' | 'player'; name: string; team: string; teamId: string; sport?: string } | undefined
  > {
    const wanted = sport?.toLowerCase();
    const pick = <T extends { strSport?: string }>(list: T[]): T | undefined =>
      (wanted ? list.find((x) => x.strSport?.toLowerCase() === wanted) : undefined) ?? list[0];

    const teams = async (term: string) => {
      tried.push(`team "${term}"`);
      // Deliberately NOT caught. A throttled provider that returns an empty
      // list is indistinguishable from a name that does not exist, and the
      // agent then tells the user there is no such team. Let it throw: the
      // chain records the failure and the skill reports a lookup problem.
      const res = await this.http.fetchJson<{ teams?: SportsDbTeam[] }>(
        `${this.base()}/searchteams.php`,
        { query: { t: term }, accept: 'application/json', minHostGapMs: HOST_GAP_MS },
      );
      const all = res.teams ?? [];
      // With a sport given, only a team in that sport counts — otherwise a
      // shared name silently resolves to the wrong sport entirely.
      return wanted ? all.filter((t) => t.strSport?.toLowerCase() === wanted) : all;
    };

    const direct = pick(await teams(name));
    if (direct?.idTeam) {
      return {
        kind: 'team',
        name: direct.strTeam ?? name,
        team: direct.strTeam ?? name,
        teamId: direct.idTeam,
        sport: direct.strSport,
      };
    }

    if (sport) {
      const qualified = pick(await teams(`${name} ${sport}`));
      if (qualified?.idTeam) {
        return {
          kind: 'team',
          name: qualified.strTeam ?? name,
          team: qualified.strTeam ?? name,
          teamId: qualified.idTeam,
          sport: qualified.strSport,
        };
      }
    }

    tried.push(`player "${name}"`);
    const res = await this.http.fetchJson<{ player?: SportsDbPlayer[] }>(
      `${this.base()}/searchplayers.php`,
      { query: { p: name }, accept: 'application/json', minHostGapMs: HOST_GAP_MS },
    );

    const players = res.player ?? [];
    const player = pick(wanted ? players.filter((p) => p.strSport?.toLowerCase() === wanted) : players);
    if (!player?.idTeam) return undefined;

    return {
      kind: 'player',
      name: player.strPlayer ?? name,
      team: player.strTeam ?? 'their club',
      teamId: player.idTeam,
      sport: player.strSport,
    };
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
      }>(url, { query: { id: teamId }, accept: 'application/json', minHostGapMs: HOST_GAP_MS });

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

/** The subset of TheSportsDB's team and player shapes we read. */
interface SportsDbTeam {
  idTeam?: string;
  strTeam?: string;
  strSport?: string;
  strLeague?: string;
}

interface SportsDbPlayer {
  idPlayer?: string;
  strPlayer?: string;
  strSport?: string;
  strTeam?: string;
  idTeam?: string;
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
