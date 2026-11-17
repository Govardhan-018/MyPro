import { describe, it, expect } from 'vitest';
import {
  groupParagraphs,
  groupBlocks,
  ocrParagraphs,
  type PdfTextItem,
} from './pdf';

/**
 * Phase 12.4 — the pure PDF-shaping logic. These functions turn positioned
 * runs into reading text and have no I/O, so they are directly testable.
 *
 * Fixtures use the engine's `eol` flag, which puts `toLines` on its
 * deterministic path (one run per line) rather than guessing lines from
 * baseline proximity. PDF y grows up the page, so lines descend in y.
 */

let y = 800;
/** One full line of text at the current y, then step down by `gap`. */
function line(
  text: string,
  opts: { width?: number; height?: number; x?: number; font?: string; gap?: number } = {},
): PdfTextItem {
  const item: PdfTextItem = {
    text,
    x: opts.x ?? 50,
    y,
    width: opts.width ?? 400,
    height: opts.height ?? 10,
    eol: true,
    ...(opts.font ? { font: opts.font } : {}),
  };
  y -= opts.gap ?? 20;
  return item;
}
function page(build: () => PdfTextItem[]): PdfTextItem[] {
  y = 800;
  return build();
}

describe('ocrParagraphs', () => {
  it('splits on blank lines', () => {
    expect(ocrParagraphs('first block\n\nsecond block')).toEqual([
      'first block',
      'second block',
    ]);
  });

  it('stitches a hyphenated word across a line break', () => {
    expect(ocrParagraphs('recog-\nnition is hard')).toEqual(['recognition is hard']);
  });

  it('joins non-hyphenated lines in a block with a single space', () => {
    expect(ocrParagraphs('one\ntwo\nthree')).toEqual(['one two three']);
  });

  it('collapses runs of whitespace', () => {
    expect(ocrParagraphs('a   b\t c')).toEqual(['a b c']);
  });

  it('drops single stray characters as recognition noise', () => {
    // "x" alone is noise; the real line survives.
    expect(ocrParagraphs('x\n\nreal line')).toEqual(['real line']);
  });

  it('handles CRLF line endings', () => {
    expect(ocrParagraphs('one\r\n\r\ntwo')).toEqual(['one', 'two']);
  });

  it('returns nothing for empty or blank input', () => {
    expect(ocrParagraphs('')).toEqual([]);
    expect(ocrParagraphs('   \n\n  ')).toEqual([]);
  });
});

describe('groupParagraphs', () => {
  it('returns nothing for an empty page', () => {
    expect(groupParagraphs([])).toEqual([]);
  });

  it('joins lines of one paragraph into a single string', () => {
    const items = page(() => [
      line('Alpha beta', { gap: 14 }),
      line('gamma delta', { gap: 14 }),
      line('epsilon zeta.'),
    ]);
    expect(groupParagraphs(items)).toEqual(['Alpha beta gamma delta epsilon zeta.']);
  });

  it('breaks a paragraph on a wide vertical gap', () => {
    const items = page(() => [
      line('First paragraph one', { gap: 14 }),
      line('first paragraph two.', { gap: 36 }), // wide gap -> break below
      line('Second paragraph here.'),
    ]);
    expect(groupParagraphs(items)).toEqual([
      'First paragraph one first paragraph two.',
      'Second paragraph here.',
    ]);
  });

  it('stitches a hyphenated word within a paragraph', () => {
    const items = page(() => [
      line('an exam-', { gap: 14 }),
      line('ple of stitching'),
    ]);
    expect(groupParagraphs(items)).toEqual(['an example of stitching']);
  });

  it('drops a page number at the top of the page', () => {
    const items = page(() => [
      line('42', { gap: 20 }), // page furniture, first line -> dropped
      line('Real body text one', { gap: 14 }),
      line('real body text two.'),
    ]);
    expect(groupParagraphs(items)).toEqual(['Real body text one real body text two.']);
  });
});

describe('groupBlocks', () => {
  it('returns nothing for an empty page', () => {
    expect(groupBlocks([])).toEqual([]);
  });

  it('classifies headings, body, subheadings and captions by relative size', () => {
    const items = page(() => [
      line('Chapter One', { height: 16, width: 200, gap: 20 }), // ratio 1.6 -> heading
      line('First body sentence continues', { gap: 20 }),
      line('and wraps onto a second line.', { gap: 20 }),
      line('A Subsection', { height: 12, width: 250, gap: 20 }), // ratio 1.2 -> subheading
      line('Body under the subsection here.', { gap: 20 }),
      line('Figure 1: a caption.', { height: 8, width: 150 }), // ratio 0.8 -> caption
    ]);
    expect(groupBlocks(items)).toEqual([
      { kind: 'heading', text: 'Chapter One', level: 1 },
      {
        kind: 'paragraph',
        text: 'First body sentence continues and wraps onto a second line.',
      },
      { kind: 'subheading', text: 'A Subsection', level: 2 },
      { kind: 'paragraph', text: 'Body under the subsection here.' },
      { kind: 'caption', text: 'Figure 1: a caption.' },
    ]);
  });
});
