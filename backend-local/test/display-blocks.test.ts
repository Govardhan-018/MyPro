import { describe, it, expect } from 'vitest';
import { blocksNote, buildBlocks } from '../src/agent/display-blocks';

/**
 * Turning tool results into cards.
 *
 * The failure this exists for: asked for cricket news, the agent produced
 * one unbroken paragraph containing a team's all-time Test, ODI and T20
 * records. Every number in it came from a tool result as a field, and was
 * flattened into prose because prose was the only output available.
 *
 * The approach is deliberately not "ask the model for JSON". These are
 * built from what the tools returned, so a card cannot cite a source that
 * was never fetched — and a parse failure cannot cost the user their reply.
 */

const out = (name: string, value: unknown) => ({ name, content: JSON.stringify(value) });

describe('buildBlocks', () => {
  it('turns search results into sources, dropping any without a link', () => {
    const [block] = buildBlocks([
      out('web_search', {
        sources: [
          { title: 'A real article', url: 'https://example.com/a', publisher: 'Example', published_at: '2026-11-20T10:00:00Z' },
          { title: 'No link', publisher: 'Example' },
          { url: 'https://example.com/b' },
        ],
      }),
    ]);

    expect(block.kind).toBe('sources');
    if (block.kind !== 'sources') return;
    expect(block.items).toHaveLength(1);
    expect(block.items[0]).toMatchObject({ title: 'A real article', publisher: 'Example' });
  });

  it('reads news results, which arrive under a different key', () => {
    const [block] = buildBlocks([
      out('news_search', { articles: [{ title: 'Headline', url: 'https://news.example/1' }] }),
    ]);
    expect(block.kind).toBe('sources');
    expect(block.from).toBe('news_search');
  });

  it('caps a card at a readable length', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      title: `Story ${i}`,
      url: `https://example.com/${i}`,
    }));
    const [block] = buildBlocks([out('web_search', { sources: many })]);
    if (block.kind !== 'sources') throw new Error('expected sources');
    expect(block.items.length).toBeLessThanOrEqual(6);
  });

  it('keeps time_unknown on a fixture, so midnight is never shown as kickoff', () => {
    const [block] = buildBlocks([
      out('sports_fixtures', {
        resolved: { kind: 'player', name: 'Someone', team: 'Their Club', sport: 'Soccer' },
        fixtures: [
          { home: 'Their Club', away: 'Rivals', starts_at: '2026-12-01T00:00:00Z', time_unknown: true },
        ],
      }),
    ]);

    if (block.kind !== 'fixtures') throw new Error('expected fixtures');
    expect(block.items[0].time_unknown).toBe(true);
    expect(block.resolved).toMatchObject({ kind: 'player', team: 'Their Club' });
  });

  it('renders no fixture card when the name never resolved', () => {
    // A miss is prose: "I could not find them". An empty card says nothing.
    expect(buildBlocks([out('sports_fixtures', { found: false, searched_for: 'nobody' })])).toEqual(
      [],
    );
  });

  it('builds a forecast card', () => {
    const [block] = buildBlocks([
      out('get_weather', {
        place: 'Somewhere',
        timezone: 'Asia/Kolkata',
        now: { temperature_c: 29.1, summary: 'clear' },
        days: [{ date: '2026-11-23', min_c: 19, max_c: 30, summary: 'clear', precipitation_chance: 0 }],
      }),
    ]);

    if (block.kind !== 'weather') throw new Error('expected weather');
    expect(block.place).toBe('Somewhere');
    expect(block.now?.temperature_c).toBe(29.1);
    expect(block.days).toHaveLength(1);
  });

  it('ignores capabilities whose output is better said in a sentence', () => {
    expect(buildBlocks([out('create_event', { id: 'x', title: 'Dentist' })])).toEqual([]);
    expect(buildBlocks([out('get_now', { iso: '2026-11-22T10:00:00Z' })])).toEqual([]);
  });

  it('survives a tool result that is an error string, not JSON', () => {
    expect(buildBlocks([{ name: 'web_search', content: 'Error: everything failed' }])).toEqual([]);
  });

  it('builds several cards from one turn, in the order the tools ran', () => {
    const blocks = buildBlocks([
      out('sports_fixtures', { fixtures: [{ home: 'A', away: 'B' }] }),
      out('get_weather', { place: 'P', days: [{ date: '2026-11-23' }] }),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['fixtures', 'weather']);
  });
});

describe('blocksNote', () => {
  it('says nothing when there is nothing on screen', () => {
    expect(blocksNote([])).toBe('');
  });

  /**
   * Without this the user reads the same five headlines twice: once as
   * cards and once paraphrased in the paragraph above them.
   */
  it('tells the model what is already shown and to give the takeaway', () => {
    const blocks = buildBlocks([
      out('news_search', { articles: [{ title: 'T', url: 'https://e.com/1' }] }),
    ]);
    const note = blocksNote(blocks);

    expect(note).toContain('ALREADY ON SCREEN');
    expect(note).toContain('1 source(s)');
    expect(note).toMatch(/do not list them/i);
  });

  it('describes each kind of card it is showing', () => {
    const note = blocksNote(
      buildBlocks([
        out('sports_fixtures', { fixtures: [{ home: 'A', away: 'B' }] }),
        out('get_weather', { place: 'Somewhere', days: [{ date: '2026-11-23' }] }),
      ]),
    );
    expect(note).toContain('fixture(s)');
    expect(note).toContain('Somewhere');
  });
});
