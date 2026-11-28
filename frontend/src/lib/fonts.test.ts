import { describe, it, expect } from 'vitest';
import { fontFaceCss, readerFontStack, READER_FONTS, DEFAULT_READER_FONT } from './fonts';

describe('bundled fonts', () => {
  it('declares every role family, Latin only, with swap', () => {
    const css = fontFaceCss();
    for (const family of ['Outfit', 'Space Grotesk', 'JetBrains Mono', 'Changa One', 'Black Ops One', 'Literata', 'Lora', 'Atkinson Hyperlegible']) {
      expect(css).toContain(`font-family: "${family}"`);
    }
    expect(css).not.toMatch(/cyrillic|greek|vietnamese/);
    expect(css.match(/font-display: swap/g)?.length).toBe(css.match(/@font-face/g)?.length);
  });

  it('reader font ids are unique and resolve to a stack, unknown → default', () => {
    expect(new Set(READER_FONTS.map((f) => f.id)).size).toBe(READER_FONTS.length);
    expect(readerFontStack('lora')).toContain('Lora');
    expect(readerFontStack('nope')).toBe(readerFontStack(DEFAULT_READER_FONT));
  });
});
