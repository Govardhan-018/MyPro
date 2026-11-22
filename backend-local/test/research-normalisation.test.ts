import { describe, it, expect } from 'vitest';
import { dedupe } from '../src/research/research.service';
import { parseSeenDate } from '../src/research/providers/gdelt.provider';
import { timestampOf } from '../src/research/providers/thesportsdb.provider';
import { describeCode } from '../src/research/providers/openmeteo.provider';
import type { SourceDoc } from '../src/research/provider.types';

/**
 * Phase 20 — the provider boundary.
 *
 * Every provider hands back a different shape, and the whole point of the
 * contract is that nothing above `research/providers/` has to know. These are
 * the normalisations that make a vendor swappable: the dates each one invents
 * its own format for, and the duplicate sources a chain inevitably produces.
 */

const source = (url: string, over: Partial<SourceDoc> = {}): SourceDoc => ({
  title: 'A title',
  url,
  fetched_at: '2026-11-22T10:00:00.000Z',
  provider: 'test',
  ...over,
});

describe('dedupe', () => {
  it('keeps the first of two identical URLs', () => {
    const out = dedupe([
      source('https://example.com/a', { provider: 'tavily' }),
      source('https://example.com/a', { provider: 'brave' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].provider).toBe('tavily');
  });

  it('treats www and bare host as the same page', () => {
    expect(dedupe([source('https://www.example.com/a'), source('https://example.com/a')])).toHaveLength(1);
  });

  it('ignores a trailing slash', () => {
    expect(dedupe([source('https://example.com/a/'), source('https://example.com/a')])).toHaveLength(1);
  });

  it('strips tracking parameters before comparing', () => {
    const out = dedupe([
      source('https://example.com/a?utm_source=news&utm_medium=email'),
      source('https://example.com/a?fbclid=123'),
      source('https://example.com/a'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps a genuinely different query', () => {
    expect(
      dedupe([source('https://example.com/s?q=cats'), source('https://example.com/s?q=dogs')]),
    ).toHaveLength(2);
  });

  it('keeps different paths and different hosts', () => {
    expect(
      dedupe([
        source('https://example.com/a'),
        source('https://example.com/b'),
        source('https://other.com/a'),
      ]),
    ).toHaveLength(3);
  });

  it('does not choke on an unparseable URL', () => {
    const out = dedupe([source('not-a-url'), source('not-a-url'), source('https://example.com/a')]);
    expect(out).toHaveLength(2);
  });
});

describe('parseSeenDate (GDELT)', () => {
  it('reads the compact stamp GDELT uses', () => {
    expect(parseSeenDate('20261122T103000Z')).toBe('2026-11-22T10:30:00.000Z');
    expect(parseSeenDate('20261122103000')).toBe('2026-11-22T10:30:00.000Z');
  });

  it('falls back to anything Date.parse understands', () => {
    expect(parseSeenDate('2026-11-22T10:30:00Z')).toBe('2026-11-22T10:30:00.000Z');
  });

  it('returns undefined rather than a wrong date', () => {
    expect(parseSeenDate(undefined)).toBeUndefined();
    expect(parseSeenDate('')).toBeUndefined();
    expect(parseSeenDate('sometime last week')).toBeUndefined();
  });
});

describe('timestampOf (TheSportsDB)', () => {
  it('reads the space-separated UTC timestamp as UTC, not local', () => {
    const result = timestampOf('2026-11-22 09:30:00');
    expect(result).toEqual({ iso: '2026-11-22T09:30:00.000Z', dateOnly: false });
  });

  it('keeps an explicit offset as given', () => {
    expect(timestampOf('2026-11-22T09:30:00Z')?.iso).toBe('2026-11-22T09:30:00.000Z');
  });

  it('combines date and time when there is no timestamp', () => {
    const result = timestampOf(undefined, '2026-11-22', '14:00:00');
    expect(result).toEqual({ iso: '2026-11-22T14:00:00.000Z', dateOnly: false });
  });

  it('flags a date with no real time, so nothing is booked at midnight', () => {
    expect(timestampOf(undefined, '2026-11-22')).toEqual({
      iso: '2026-11-22T00:00:00.000Z',
      dateOnly: true,
    });
    expect(timestampOf(undefined, '2026-11-22', '00:00:00')?.dateOnly).toBe(true);
  });

  it('returns undefined when there is no date at all', () => {
    expect(timestampOf(undefined, undefined, '14:00:00')).toBeUndefined();
    expect(timestampOf('nonsense')).toBeUndefined();
  });
});

describe('describeCode (Open-Meteo)', () => {
  it('turns WMO codes into words', () => {
    expect(describeCode(0)).toBe('clear');
    expect(describeCode(63)).toBe('rain');
    expect(describeCode(95)).toBe('thunderstorm');
  });

  it('says nothing rather than guessing at an unknown code', () => {
    expect(describeCode(undefined)).toBeUndefined();
    expect(describeCode(404)).toBeUndefined();
  });
});
