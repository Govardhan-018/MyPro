import { describe, it, expect } from 'vitest';
import { UNSORTED_KEY, groupKnowledge, normalizeTitle, searchGroups, sortGroups } from './knowledgeGroups';
import type { KnowledgeEntry } from './useKnowledge';

let n = 0;
const entry = (over: Partial<KnowledgeEntry>): KnowledgeEntry => ({
  id: `e${++n}`,
  kind: 'Note',
  text: 'text',
  bookTitle: 'Sapiens',
  page: 1,
  sourceType: 'book',
  date: '2026-11-20T10:00:00Z',
  tone: 'lavender',
  tags: [],
  ...over,
});

describe('groupKnowledge', () => {
  it('puts every note and quote from one book into one group, and other books in their own', () => {
    const groups = groupKnowledge([
      entry({ kind: 'Note' }),
      entry({ kind: 'Quote' }),
      entry({ bookTitle: 'Atomic Habits', kind: 'Highlight' }),
    ]);
    expect(groups).toHaveLength(2);
    const sapiens = groups.find((g) => g.title === 'Sapiens')!;
    expect(sapiens.entries).toHaveLength(2);
    expect(sapiens.kinds).toEqual({ Note: 1, Quote: 1 });
  });

  it('merges the same source written differently (case, article, subtitle)', () => {
    const groups = groupKnowledge([
      entry({ bookTitle: 'Sapiens' }),
      entry({ bookTitle: 'sapiens ' }),
      entry({ bookTitle: 'Sapiens: A Brief History of Humankind', creator: 'Yuval Noah Harari' }),
      entry({ bookTitle: 'The Sapiens' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(4);
    expect(groups[0].creator).toBe('Yuval Noah Harari');
  });

  it('keeps apart different books that share a short title but not an author', () => {
    const groups = groupKnowledge([
      entry({ bookTitle: 'Range: Why Generalists Triumph', creator: 'David Epstein' }),
      entry({ bookTitle: 'Range: A Novel', creator: 'Someone Else' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('a book and a podcast with the same title are different sources', () => {
    const groups = groupKnowledge([
      entry({ bookTitle: 'Deep Work' }),
      entry({ bookTitle: 'Deep Work', sourceType: 'podcast' }),
    ]);
    expect(groups.map((g) => g.sourceType).sort()).toEqual(['book', 'podcast']);
  });

  it('entries with no source land in one Unsorted group — nothing is lost', () => {
    const items = [entry({ bookTitle: '' }), entry({ bookTitle: '   ', sourceType: undefined }), entry({})];
    const groups = groupKnowledge(items);
    const unsorted = groups.find((g) => g.key === UNSORTED_KEY)!;
    expect(unsorted.entries).toHaveLength(2);
    expect(groups.reduce((sum, g) => sum + g.entries.length, 0)).toBe(items.length);
  });

  it('orders a group by page, and tracks its newest entry', () => {
    const [g] = groupKnowledge([
      entry({ page: 9, date: '2026-11-01T00:00:00Z' }),
      entry({ page: 2, date: '2026-11-22T00:00:00Z' }),
    ]);
    expect(g.entries.map((e) => e.page)).toEqual([2, 9]);
    expect(g.lastAt).toBe(Date.parse('2026-11-22T00:00:00Z'));
  });
});

describe('sort and search', () => {
  const groups = groupKnowledge([
    entry({ bookTitle: 'Zen', date: '2026-11-01T00:00:00Z' }),
    entry({ bookTitle: 'Atlas', date: '2026-11-21T00:00:00Z', text: 'the map is not the territory' }),
    entry({ bookTitle: 'Atlas', date: '2026-11-02T00:00:00Z' }),
    entry({ bookTitle: '' }),
  ]);

  it('sorts by recency, title or size, with Unsorted always last', () => {
    expect(sortGroups(groups, 'recent').map((g) => g.title)).toEqual(['Atlas', 'Zen', 'Unsorted']);
    expect(sortGroups(groups, 'az').map((g) => g.title)).toEqual(['Atlas', 'Zen', 'Unsorted']);
    expect(sortGroups(groups, 'count')[0].title).toBe('Atlas');
  });

  it('matches a group by title (all entries) or by entry text (only those)', () => {
    expect(searchGroups(groups, 'zen')[0].entries).toHaveLength(1);
    const byText = searchGroups(groups, 'territory');
    expect(byText).toHaveLength(1);
    expect(byText[0].title).toBe('Atlas');
    expect(byText[0].entries).toHaveLength(1);
  });
});

describe('normalizeTitle', () => {
  it('ignores case, accents, punctuation and a leading article', () => {
    expect(normalizeTitle('  The Café — Notes!  ')).toBe(normalizeTitle('cafe notes'));
  });
});
