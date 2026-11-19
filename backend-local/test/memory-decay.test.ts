import { describe, it, expect } from 'vitest';
import { effectiveConfidence, isFaded, liveFacts, FADE_FLOOR } from '../src/memory/decay';

/** Phase 16.2 — fact decay: facts that stop being used fade from the prompt. */

const DAY = 86_400_000;

describe('effectiveConfidence', () => {
  const now = 1_000 * DAY;
  it('keeps full confidence for a fact used just now', () => {
    expect(effectiveConfidence(0.9, now, now)).toBeCloseTo(0.9, 5);
  });
  it('halves confidence after one half-life', () => {
    expect(effectiveConfidence(0.8, now - 45 * DAY, now, 45)).toBeCloseTo(0.4, 5);
  });
  it('defaults missing confidence to 0.5', () => {
    expect(effectiveConfidence(null, now, now)).toBeCloseTo(0.5, 5);
  });
  it('never decays a fact with no last_used_at', () => {
    expect(effectiveConfidence(0.7, null, now)).toBeCloseTo(0.7, 5);
  });
});

describe('isFaded', () => {
  it('fades a value below the floor', () => {
    expect(isFaded(FADE_FLOOR - 0.01)).toBe(true);
    expect(isFaded(FADE_FLOOR + 0.01)).toBe(false);
  });
});

describe('liveFacts', () => {
  const now = 1_000 * DAY;
  it('drops faded facts, keeps and sorts the live ones strongest-first', () => {
    const facts = [
      { key: 'fresh_strong', value: 'a', confidence: 0.9, last_used_at: new Date(now).toISOString() },
      { key: 'stale', value: 'b', confidence: 0.6, last_used_at: new Date(now - 400 * DAY).toISOString() },
      { key: 'fresh_mid', value: 'c', confidence: 0.5, last_used_at: new Date(now).toISOString() },
    ];
    const live = liveFacts(facts, now).map((f) => f.key);
    expect(live).toEqual(['fresh_strong', 'fresh_mid']);
  });
  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      key: `k${i}`,
      value: 'v',
      confidence: 0.9,
      last_used_at: new Date(now).toISOString(),
    }));
    expect(liveFacts(many, now, 20)).toHaveLength(20);
  });
});
