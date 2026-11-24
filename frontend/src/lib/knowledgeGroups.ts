/**
 * My Knowledge, grouped by where it came from (a book, a podcast episode, an
 * article). Groups are *derived* from the entries every time — nothing is
 * stored, so there is nothing to migrate, nothing to fall out of date, and a
 * new source type groups itself the moment it has entries.
 *
 * Pure and unit-tested (`knowledgeGroups.test.ts`).
 */
import type { KnowledgeEntry, KnowledgeKind } from './useKnowledge';

export type SourceType = NonNullable<KnowledgeEntry['sourceType']> | 'unknown';

export interface KnowledgeGroup {
  /** Stable key for React and for re-opening the same group. */
  key: string;
  title: string;
  sourceType: SourceType;
  creator?: string;
  cover?: string;
  entries: KnowledgeEntry[];
  /** Count per kind, e.g. { Note: 3, Quote: 1 }. */
  kinds: Partial<Record<KnowledgeKind, number>>;
  /** Newest entry's time (ms since epoch; 0 when no entry has a parsable date). */
  lastAt: number;
}

/** The group for entries whose source is gone or was never recorded. */
export const UNSORTED_KEY = 'unsorted';

const SUBTITLE = /\s*(?::|\s[–—-]\s|\(|\[).*$/;

/**
 * A comparable form of a title: case, accents, punctuation, a leading article
 * and spacing don't make "The Sapiens" a different book from "sapiens".
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`"“”]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s+/g, ' ');
}

/** The title without its subtitle: "Sapiens: A Brief History…" → "sapiens". */
export function mainTitle(title: string): string {
  const head = title.replace(SUBTITLE, '');
  return normalizeTitle(head || title);
}

const creatorKey = (creator?: string) => (creator ? normalizeTitle(creator) : '');

function timeOf(value: string): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

interface Bucket {
  key: string;
  type: SourceType;
  main: string;
  creator: string;
  titles: Map<string, number>;
  creators: Map<string, number>;
  cover?: string;
  entries: KnowledgeEntry[];
}

/** The most frequent value (first seen wins a tie). */
function commonest(counts: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Group entries by source.
 *
 *  1. Exact source: same type and same normalized full title.
 *  2. Duplicates across formats: groups of the same type whose *main* titles
 *     match ("Sapiens" / "Sapiens: A Brief History of Humankind") merge when
 *     their authors agree or one is unknown. Different authors stay apart, so
 *     two different books that share a short title are never merged.
 *  3. No source at all → one "Unsorted" group, so nothing is ever hidden.
 */
export function groupKnowledge(entries: KnowledgeEntry[]): KnowledgeGroup[] {
  const buckets = new Map<string, Bucket>();

  for (const entry of entries) {
    const rawTitle = entry.bookTitle?.trim() ?? '';
    const type: SourceType = entry.sourceType ?? 'unknown';
    const full = rawTitle ? normalizeTitle(rawTitle) : '';
    const key = full ? `${type}:${full}` : UNSORTED_KEY;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        type: full ? type : 'unknown',
        main: full ? mainTitle(rawTitle) : '',
        creator: creatorKey(entry.creator),
        titles: new Map(),
        creators: new Map(),
        entries: [],
      };
      buckets.set(key, bucket);
    }
    bucket.entries.push(entry);
    if (rawTitle) bucket.titles.set(rawTitle, (bucket.titles.get(rawTitle) ?? 0) + 1);
    if (entry.creator) {
      bucket.creators.set(entry.creator, (bucket.creators.get(entry.creator) ?? 0) + 1);
      if (!bucket.creator) bucket.creator = creatorKey(entry.creator);
    }
    if (!bucket.cover && entry.cover) bucket.cover = entry.cover;
  }

  // Pass 2: merge the same source written two ways.
  const merged: Bucket[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.key === UNSORTED_KEY) {
      merged.push(bucket);
      continue;
    }
    const twin = merged.find(
      (other) =>
        other.key !== UNSORTED_KEY &&
        other.type === bucket.type &&
        other.main === bucket.main &&
        (!other.creator || !bucket.creator || other.creator === bucket.creator),
    );
    if (!twin) {
      merged.push(bucket);
      continue;
    }
    twin.entries.push(...bucket.entries);
    for (const [t, n] of bucket.titles) twin.titles.set(t, (twin.titles.get(t) ?? 0) + n);
    for (const [c, n] of bucket.creators) twin.creators.set(c, (twin.creators.get(c) ?? 0) + n);
    twin.creator ||= bucket.creator;
    twin.cover ||= bucket.cover;
  }

  return merged.map((bucket) => {
    const kinds: Partial<Record<KnowledgeKind, number>> = {};
    let lastAt = 0;
    for (const entry of bucket.entries) {
      kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
      lastAt = Math.max(lastAt, timeOf(entry.date));
    }
    const sorted = [...bucket.entries].sort((a, b) => {
      // Reading order within a source: by page/position, then newest first.
      if (a.page !== b.page) return (a.page || 0) - (b.page || 0);
      return timeOf(b.date) - timeOf(a.date);
    });
    return {
      key: bucket.key,
      title: bucket.key === UNSORTED_KEY ? 'Unsorted' : (commonest(bucket.titles) ?? 'Untitled'),
      sourceType: bucket.type,
      creator: commonest(bucket.creators),
      cover: bucket.cover,
      entries: sorted,
      kinds,
      lastAt,
    };
  });
}

export type GroupSort = 'recent' | 'az' | 'count';

/** Sort groups; "Unsorted" always goes last. */
export function sortGroups(groups: KnowledgeGroup[], sort: GroupSort): KnowledgeGroup[] {
  const ordered = [...groups].sort((a, b) => {
    if (sort === 'az') return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    if (sort === 'count') return b.entries.length - a.entries.length || b.lastAt - a.lastAt;
    return b.lastAt - a.lastAt || a.title.localeCompare(b.title);
  });
  return [
    ...ordered.filter((g) => g.key !== UNSORTED_KEY),
    ...ordered.filter((g) => g.key === UNSORTED_KEY),
  ];
}

/**
 * Search across groups: a group matches on its title or author (all its
 * entries shown), or on the text of some entries (only those shown).
 */
export function searchGroups(groups: KnowledgeGroup[], query: string): KnowledgeGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const out: KnowledgeGroup[] = [];
  for (const group of groups) {
    const head = `${group.title} ${group.creator ?? ''}`.toLowerCase();
    if (head.includes(q)) {
      out.push(group);
      continue;
    }
    const hits = group.entries.filter((e) =>
      `${e.text} ${e.heading ?? ''} ${e.tags.join(' ')}`.toLowerCase().includes(q),
    );
    if (hits.length) out.push({ ...group, entries: hits });
  }
  return out;
}
