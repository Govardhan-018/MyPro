import { describe, it, expect } from 'vitest';
import { score, noveltyFromLastSent, gate, rank, type Candidate } from '../src/pulse/scoring';

/** Phase 16.3 — the Pulse's scoring and gates, the logic that decides whether
 *  the companion speaks. Pure, so directly testable. */

describe('score', () => {
  it('multiplies the three factors', () => {
    expect(score({ urgency: 1, value: 1, novelty: 1 })).toBe(1);
    expect(score({ urgency: 0.5, value: 0.5, novelty: 1 })).toBeCloseTo(0.25, 5);
  });
  it('clamps each factor into [0,1]', () => {
    expect(score({ urgency: 2, value: 1, novelty: 1 })).toBe(1);
    expect(score({ urgency: -1, value: 1, novelty: 1 })).toBe(0);
  });
});

describe('noveltyFromLastSent', () => {
  const HL = 24 * 3600_000;
  it('is 1 when the signal has never fired', () => {
    expect(noveltyFromLastSent(null, 1_000)).toBe(1);
  });
  it('is near 0 right after firing and ~0.5 a half-life later', () => {
    const now = 10 * HL;
    expect(noveltyFromLastSent(now, now, HL)).toBeCloseTo(0, 5);
    expect(noveltyFromLastSent(now - HL, now, HL)).toBeCloseTo(0.5, 5);
  });
  it('recovers toward 1 as time passes', () => {
    const now = 100 * HL;
    expect(noveltyFromLastSent(now - 5 * HL, now, HL)).toBeGreaterThan(0.95);
  });
});

describe('gate', () => {
  const base = { minScore: 0.2, cooldownMs: 3600_000, dailyBudget: 3 };
  it('sends a strong, cooled-down, in-budget candidate', () => {
    expect(
      gate({ ...base, score: 0.5, sinceLastOfTypeMs: 2 * 3600_000, sentToday: 0 }),
    ).toEqual({ outcome: 'sent' });
  });
  it('suppresses low_score first', () => {
    expect(gate({ ...base, score: 0.1, sinceLastOfTypeMs: 0, sentToday: 9 })).toEqual({
      outcome: 'suppressed',
      reason: 'low_score',
    });
  });
  it('suppresses cooldown before budget', () => {
    expect(gate({ ...base, score: 0.9, sinceLastOfTypeMs: 60_000, sentToday: 9 })).toEqual({
      outcome: 'suppressed',
      reason: 'cooldown',
    });
  });
  it('suppresses on budget when score and cooldown pass', () => {
    expect(
      gate({ ...base, score: 0.9, sinceLastOfTypeMs: 10 * 3600_000, sentToday: 3 }),
    ).toEqual({ outcome: 'suppressed', reason: 'budget' });
  });
});

describe('rank', () => {
  it('orders strongest-first', () => {
    const cs: Candidate[] = [
      { signalType: 'task', urgency: 0.2, value: 0.2, novelty: 1 },
      { signalType: 'commitment', urgency: 1, value: 1, novelty: 1 },
      { signalType: 'email', urgency: 0.6, value: 0.6, novelty: 1 },
    ];
    expect(rank(cs).map((c) => c.signalType)).toEqual(['commitment', 'email', 'task']);
  });
});
