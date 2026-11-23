import { describe, it, expect } from 'vitest';
import { orIlike } from '../src/common/crud';

/**
 * The library search filter is embedded in PostgREST's comma-delimited
 * `or=(…)` grammar. A raw query with a comma or parenthesis used to split that
 * grammar into broken fragments — "that book, the one" matched nothing and
 * never errored. The same helper and the same check live in backend-local
 * (orIlike there); change one, change both.
 */
describe('orIlike', () => {
  it('produces one quoted ilike condition per column', () => {
    expect(orIlike('cal', ['title', 'creator'])).toBe('title.ilike."%cal%",creator.ilike."%cal%"');
  });

  it('keeps a comma and parens literal inside the quotes', () => {
    expect(orIlike('a, b (c)', ['title'])).toBe('title.ilike."%a, b (c)%"');
  });

  it('escapes a double quote and a backslash so the grammar cannot be escaped', () => {
    expect(orIlike('a"b\\c', ['t'])).toBe('t.ilike."%a\\"b\\\\c%"');
  });
});
