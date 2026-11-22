import { describe, it, expect, vi } from 'vitest';

/*
 * The provider reads `env()` for its API key, and `env()` validates the
 * whole environment or throws. Set a stub one before importing anything
 * that might reach it — the agent refusing to boot on an incomplete
 * environment is a feature everywhere except here.
 */
Object.assign(process.env, {
  NODE_ENV: 'test',
  CORS_ORIGINS: 'http://localhost',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_value_0000',
  SUPABASE_SECRET_KEY: 'sb_secret_test_value_00000000',
  INTERNAL_SERVICE_TOKEN: 'x'.repeat(48),
  GROQ_API_KEY: 'gsk_test_value',
});

const { TheSportsDbProvider } = await import('../src/research/providers/thesportsdb.provider');

/**
 * Turning a name into fixtures.
 *
 * From a real session: "check when is the Ronaldo next match" came back as
 * "there are no upcoming matches listed for Ronaldo", stated as fact. Two
 * separate faults produced that single sentence, and both are tested here:
 *
 *  1. A person was only ever looked up as a team, so the name never
 *     resolved to anything.
 *  2. Every lookup was wrapped in a catch that turned an error into an
 *     empty list, so a throttled provider and a non-existent team were
 *     indistinguishable — and the agent reported the confident version.
 *
 * The resolution ladder is general: nothing here knows any player, team or
 * sport by name. It is driven entirely by what the provider returns.
 */

/** A fake HTTP layer that answers from a fixture map, and counts calls. */
function fakeHttp(routes: Record<string, unknown>) {
  const calls: string[] = [];
  return {
    calls,
    http: {
      fetchJson: vi.fn(async (url: string, options?: { query?: Record<string, unknown> }) => {
        const endpoint = url.split('/').pop() ?? '';
        const term = String(options?.query?.t ?? options?.query?.p ?? options?.query?.id ?? '');
        const key = `${endpoint}:${term}`;
        calls.push(key);
        if (key in routes) return routes[key];
        // Unknown name: the provider's own "nothing found" shape.
        if (endpoint.startsWith('searchteams')) return { teams: null };
        if (endpoint.startsWith('searchplayers')) return { player: null };
        return { events: [] };
      }),
    },
  };
}

const event = (home: string, away: string, date: string) => ({
  idEvent: '1',
  strHomeTeam: home,
  strAwayTeam: away,
  dateEvent: date,
  strTimestamp: `${date} 18:00:00`,
  strSport: 'Soccer',
});

describe('resolving a name to fixtures', () => {
  it('finds a team directly', async () => {
    const { http, calls } = fakeHttp({
      'searchteams.php:Anytown United': { teams: [{ idTeam: '1', strTeam: 'Anytown United', strSport: 'Soccer' }] },
      'eventsnext.php:1': { events: [event('Anytown United', 'Someone', '2026-12-01')] },
    });
    const result = await new TheSportsDbProvider(http as never).fixtures({
      team: 'Anytown United',
      limit: 5,
    });

    expect(result.resolved).toMatchObject({ kind: 'team', team: 'Anytown United' });
    expect(result.fixtures).toHaveLength(1);
    // No player lookup needed when the team search answered.
    expect(calls.some((c) => c.startsWith('searchplayers'))).toBe(false);
  });

  it('qualifies by sport when a bare name belongs to another sport', async () => {
    // A shared name: the plain search returns the wrong sport, and the
    // provider catalogues the other one as "<name> <sport>".
    const { http } = fakeHttp({
      'searchteams.php:Someplace': { teams: [{ idTeam: '1', strTeam: 'Someplace', strSport: 'Soccer' }] },
      'searchteams.php:Someplace Cricket': {
        teams: [{ idTeam: '2', strTeam: 'Someplace Cricket', strSport: 'Cricket' }],
      },
      'eventsnext.php:2': { events: [event('Someplace Cricket', 'Elsewhere', '2026-12-02')] },
    });

    const result = await new TheSportsDbProvider(http as never).fixtures({
      team: 'Someplace',
      sport: 'Cricket',
      limit: 5,
    });

    expect(result.resolved).toMatchObject({ kind: 'team', team: 'Someplace Cricket', sport: 'Cricket' });
    expect(result.tried).toContain('team "Someplace Cricket"');
  });

  it('falls back to a person, following the id on the player record', async () => {
    // The player's team NAME frequently matches no team search at all, so
    // the id is followed instead — more reliable and one call cheaper.
    const { http, calls } = fakeHttp({
      'searchplayers.php:Some Player': {
        player: [{ strPlayer: 'Some Player', strSport: 'Soccer', strTeam: 'Odd-Name FC', idTeam: '77' }],
      },
      'eventsnext.php:77': { events: [event('Odd-Name FC', 'Rivals', '2026-12-03')] },
    });

    const result = await new TheSportsDbProvider(http as never).fixtures({
      team: 'Some Player',
      limit: 5,
    });

    expect(result.resolved).toMatchObject({ kind: 'player', name: 'Some Player', team: 'Odd-Name FC' });
    expect(result.fixtures).toHaveLength(1);
    // The club name was never re-searched; the id was used directly.
    expect(calls).not.toContain('searchteams.php:Odd-Name FC');
  });

  it('reports what it looked for when nothing matches', async () => {
    const { http } = fakeHttp({});
    const result = await new TheSportsDbProvider(http as never).fixtures({
      team: 'Nobody At All',
      sport: 'Cricket',
      limit: 5,
    });

    expect(result.resolved).toBeNull();
    expect(result.fixtures).toEqual([]);
    // The caller can say "I looked for X and Y" instead of asserting
    // that no such team exists.
    expect(result.tried).toEqual([
      'team "Nobody At All"',
      'team "Nobody At All Cricket"',
      'player "Nobody At All"',
    ]);
  });

  it('lets a provider error through instead of reporting "not found"', async () => {
    // The whole point: a throttled provider must not look like a name that
    // does not exist. This is what produced a confident false statement.
    const http = {
      fetchJson: vi.fn(async () => {
        throw new Error('http_status: 429 from the provider');
      }),
    };

    await expect(
      new TheSportsDbProvider(http as never).fixtures({ team: 'Anyone', limit: 5 }),
    ).rejects.toThrow(/429/);
  });

  it('returns an empty result for an empty query without calling out', async () => {
    const { http, calls } = fakeHttp({});
    const result = await new TheSportsDbProvider(http as never).fixtures({ limit: 5 });

    expect(result).toEqual({ fixtures: [], resolved: null, tried: [] });
    expect(calls).toEqual([]);
  });
});
