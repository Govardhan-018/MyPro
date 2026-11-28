import { describe, it, expect } from 'vitest';
import { pickIndex, pickQuote, QUOTE_BACKGROUNDS } from './QuoteCard';
import { QUOTES } from '../data/quotes';

describe('quotes', () => {
  it('every quote has a unique id, text and author', () => {
    expect(new Set(QUOTES.map((q) => q.id)).size).toBe(QUOTES.length);
    for (const q of QUOTES) {
      expect(q.text.trim()).not.toBe('');
      expect(q.author.trim()).not.toBe('');
    }
  });

  it('there are 8–10 backgrounds', () => {
    expect(QUOTE_BACKGROUNDS.length).toBeGreaterThanOrEqual(8);
    expect(QUOTE_BACKGROUNDS.length).toBeLessThanOrEqual(10);
  });
});

describe('never the same quote twice in a row', () => {
  it('pickIndex skips the excluded index at every random value', () => {
    for (let i = 0; i < 100; i++) {
      const r = i / 100;
      const n = pickIndex(5, 2, () => r);
      expect(n).not.toBe(2);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(5);
    }
  });

  it('pickIndex still reaches every other index', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(pickIndex(5, 2, () => i / 100));
    expect([...seen].sort()).toEqual([0, 1, 3, 4]);
  });

  it('pickQuote excludes the last id, and copes with one or none', () => {
    const last = QUOTES[0].id;
    for (let i = 0; i < 50; i++) expect(pickQuote(QUOTES, last, () => i / 50)?.id).not.toBe(last);
    expect(pickQuote([QUOTES[0]], QUOTES[0].id)?.id).toBe(QUOTES[0].id);
    expect(pickQuote([], null)).toBeNull();
    // An unknown last id (e.g. a quote since removed) is simply ignored.
    expect(pickQuote(QUOTES, 'gone')).not.toBeNull();
  });
});
