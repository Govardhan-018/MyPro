import { describe, it, expect } from 'vitest';
import { isStalePosition } from '../src/library/library.module';
import { insertOnce } from '../src/library/reader.module';

/**
 * Offline reading sync — the server's half.
 *  - A position recorded earlier than the stored one never overwrites it
 *    (a phone syncing yesterday's offline reading cannot rewind the laptop).
 *  - A create retried after a dropped connection returns the same row.
 */
describe('isStalePosition', () => {
  it('rejects an older position, accepts a newer or equal one', () => {
    expect(isStalePosition('2026-11-24T10:00:00Z', '2026-11-24T09:00:00Z')).toBe(true);
    expect(isStalePosition('2026-11-24T10:00:00Z', '2026-11-24T11:00:00Z')).toBe(false);
    expect(isStalePosition('2026-11-24T10:00:00Z', '2026-11-24T10:00:00Z')).toBe(false);
  });
  it('with nothing to compare (first write, or an old client) the write goes through', () => {
    expect(isStalePosition(null, '2026-11-24T09:00:00Z')).toBe(false);
    expect(isStalePosition('2026-11-24T10:00:00Z', undefined)).toBe(false);
  });
});

/** Just enough of the supabase-js builder for insertOnce. */
function fakeDb(existing: Record<string, unknown>[]) {
  const rows = [...existing];
  let inserts = 0;
  const db = {
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            inserts += 1;
            if (rows.some((r) => r.id === row.id)) {
              return { data: null, error: { code: '23505', message: 'duplicate key' } };
            }
            rows.push(row);
            return { data: row, error: null };
          },
        }),
      }),
      select: () => ({
        eq: (_k: string, v: unknown) => ({
          maybeSingle: async () => ({ data: rows.find((r) => r.id === v) ?? null, error: null }),
        }),
      }),
    }),
  };
  return { db: db as never, rows, inserts: () => inserts };
}

describe('insertOnce', () => {
  it('a retried create with the same client id returns the existing row — no duplicate', async () => {
    const { db, rows } = fakeDb([]);
    const row = { id: '3f6c1d1e-4b7a-4c1e-9a2b-1c2d3e4f5a6b', kind: 'note', body: 'hi' };
    const first = await insertOnce(db, 'annotations', row);
    const again = await insertOnce(db, 'annotations', row);
    expect(again).toEqual(first);
    expect(rows).toHaveLength(1);
  });
});
