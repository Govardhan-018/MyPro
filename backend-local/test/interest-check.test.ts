import { describe, it, expect } from 'vitest';
import { fingerprint, importanceOf, isDue, mentions } from '../src/pulse/interest-check';

/**
 * Phase 20.6 — deciding whether a development is worth interrupting someone.
 *
 * This is the logic that separates a companion from a notification firehose,
 * and the two failure modes are opposite: say nothing and it is useless, say
 * everything and it gets muted within a day. The fingerprint is the more
 * important half — a system that delivers the same story twice has already
 * lost the user's trust, whatever else it gets right.
 */

const NOW = Date.parse('2026-11-22T12:00:00Z');
const hoursAgo = (n: number) => new Date(NOW - n * 3_600_000).toISOString();

describe('fingerprint', () => {
  it('is stable for the same URL', () => {
    const a = { title: 'One', url: 'https://example.com/story' };
    expect(fingerprint(a)).toBe(fingerprint({ ...a, title: 'A different headline' }));
  });

  it('ignores www, trailing slashes and tracking parameters', () => {
    const base = fingerprint({ title: 'x', url: 'https://example.com/story' });
    expect(fingerprint({ title: 'x', url: 'https://www.example.com/story' })).toBe(base);
    expect(fingerprint({ title: 'x', url: 'https://example.com/story/' })).toBe(base);
    expect(fingerprint({ title: 'x', url: 'https://example.com/story?utm_source=feed' })).toBe(base);
  });

  it('separates genuinely different stories', () => {
    expect(fingerprint({ title: 'x', url: 'https://example.com/a' })).not.toBe(
      fingerprint({ title: 'x', url: 'https://example.com/b' }),
    );
  });

  it('falls back to the title when there is no URL', () => {
    expect(fingerprint({ title: 'India win the series' })).toBe(
      fingerprint({ title: '  india WIN the series ' }),
    );
  });

  it('does not throw on a malformed URL', () => {
    expect(fingerprint({ title: 'x', url: 'not a url' })).toHaveLength(32);
  });
});

describe('importanceOf', () => {
  it('rates a concrete development above routine coverage', () => {
    const big = importanceOf(
      { title: 'India win the series after record chase', published_at: hoursAgo(3) },
      NOW,
    );
    const routine = importanceOf({ title: 'India squad trains in Mumbai', published_at: hoursAgo(3) }, NOW);
    expect(big).toBeGreaterThan(routine);
  });

  it('marks speculation and listicles down', () => {
    const speculation = importanceOf(
      { title: 'Why India could win the World Cup, and five reasons they might not', published_at: hoursAgo(2) },
      NOW,
    );
    expect(speculation).toBeLessThan(0.5);
  });

  it('prefers fresh over week-old', () => {
    const fresh = importanceOf({ title: 'Team announced', published_at: hoursAgo(2) }, NOW);
    const stale = importanceOf({ title: 'Team announced', published_at: hoursAgo(24 * 10) }, NOW);
    expect(fresh).toBeGreaterThan(stale);
  });

  it('is sceptical of an undated story', () => {
    const dated = importanceOf({ title: 'Captain signs new deal', published_at: hoursAgo(6) }, NOW);
    const undated = importanceOf({ title: 'Captain signs new deal' }, NOW);
    expect(undated).toBeLessThan(dated);
  });

  it('stays inside 0..1 and gives an empty title nothing', () => {
    expect(importanceOf({ title: '' }, NOW)).toBe(0);
    for (const title of ['wins record signs announced launch final champion breaks', 'why could preview opinion best top']) {
      const score = importanceOf({ title, published_at: hoursAgo(1) }, NOW);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe('mentions', () => {
  it('matches the entity or any alias', () => {
    expect(mentions({ title: 'India beat Australia' }, 'India', [])).toBe(true);
    expect(mentions({ title: 'Team India named' }, 'India', ['Team India'])).toBe(true);
    expect(mentions({ title: 'BCCI statement' }, 'India', ['BCCI'])).toBe(true);
  });

  it('rejects a story that only shares a word with the category', () => {
    expect(mentions({ title: 'Australia beat England' }, 'India', [])).toBe(false);
  });

  it('is case-insensitive and ignores empty aliases', () => {
    expect(mentions({ title: 'india WIN' }, 'India', ['', ' '])).toBe(true);
  });
});

describe('isDue', () => {
  const base = { check_every_hours: 24, active: true };

  it('is due when never checked', () => {
    expect(isDue({ ...base, last_checked_at: null }, NOW)).toBe(true);
  });

  it('is not due inside its own interval', () => {
    expect(isDue({ ...base, last_checked_at: hoursAgo(5) }, NOW)).toBe(false);
  });

  it('is due once the interval has passed', () => {
    expect(isDue({ ...base, last_checked_at: hoursAgo(25) }, NOW)).toBe(true);
  });

  it('is never due while paused — this is what mute means', () => {
    expect(isDue({ ...base, active: false, last_checked_at: null }, NOW)).toBe(false);
  });

  it('treats an unparseable timestamp as due rather than stuck', () => {
    expect(isDue({ ...base, last_checked_at: 'nonsense' }, NOW)).toBe(true);
  });
});
