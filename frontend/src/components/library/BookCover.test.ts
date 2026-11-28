import { describe, it, expect } from 'vitest';
import { coverDesign, coverHash, initialsOf } from './BookCover';

describe('typographic covers', () => {
  it('the same book always gets the same cover', () => {
    expect(coverDesign('b1')).toEqual(coverDesign('b1'));
    expect(coverHash('Atomic Habits')).toBe(coverHash('Atomic Habits'));
  });

  it('different books spread across colourways and motifs', () => {
    const designs = Array.from({ length: 40 }, (_, i) => coverDesign(`book-${i}`));
    expect(new Set(designs.map((d) => d.palette.accent)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(designs.map((d) => d.motif)).size).toBeGreaterThanOrEqual(5);
  });

  it('initials read naturally', () => {
    expect(initialsOf('Robert Greene')).toBe('RG');
    expect(initialsOf('Yuval Noah Harari')).toBe('YH');
    expect(initialsOf('Plato')).toBe('PL');
    expect(initialsOf('  ')).toBe('');
  });
});
