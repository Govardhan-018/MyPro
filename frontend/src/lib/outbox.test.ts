import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '@mypro/shared';
import { classify, drain, enqueue, isUuid, uuid, type OutboxOp } from './outbox';

/**
 * The offline outbox. Before it, reader/podcast writes were fire-and-forget:
 * progress and notes made offline were silently dropped.
 */

let n = 0;
const at = () => new Date(Date.UTC(2026, 10, 24, 10, 0, n)).toISOString();
const patch = (itemId: string, body: Record<string, unknown>): OutboxOp => ({
  id: `p${++n}`,
  kind: 'library.patch',
  itemId,
  body,
  at: at(),
});
const createNote = (id: string): OutboxOp => ({
  id: `c${++n}`,
  kind: 'annotation.create',
  itemId: 'book',
  body: { id, kind: 'note', body: 'hi' },
  at: at(),
});

describe('enqueue', () => {
  it('collapses repeated progress for one book into a single change with the latest values', () => {
    let q: OutboxOp[] = [];
    q = enqueue(q, patch('b1', { progress: 10, details: { current_page: 10 }, position_at: 't1' }));
    q = enqueue(q, patch('b2', { progress: 50 }));
    q = enqueue(q, patch('b1', { progress: 12, details: { current_page: 12 }, position_at: 't2' }));
    expect(q).toHaveLength(2);
    expect(q[0]).toMatchObject({
      kind: 'library.patch',
      itemId: 'b1',
      body: { progress: 12, details: { current_page: 12 }, position_at: 't2' },
    });
  });

  it('keeps a position timestamp when a later patch carries none (e.g. a rename)', () => {
    let q = enqueue([], patch('b1', { progress: 30, position_at: 't1' }));
    q = enqueue(q, patch('b1', { title: 'New title' }));
    expect((q[0] as Extract<OutboxOp, { kind: 'library.patch' }>).body).toMatchObject({
      progress: 30,
      title: 'New title',
      position_at: 't1',
    });
  });

  it('a note created and deleted while offline never reaches the server', () => {
    let q = enqueue([], createNote('n1'));
    q = enqueue(q, { id: 'd', kind: 'annotation.delete', annotationId: 'n1', at: at() });
    expect(q).toEqual([]);
  });

  it('deleting a note the server already has is queued', () => {
    const q = enqueue([], { id: 'd', kind: 'annotation.delete', annotationId: 'server-id', at: at() });
    expect(q).toHaveLength(1);
  });
});

describe('classify', () => {
  const op = createNote('x');
  it('retries network failures, a waking server, rate limits and auth hiccups', () => {
    expect(classify(op, new TypeError('Failed to fetch'))).toBe('retry');
    for (const s of [0, 401, 408, 429, 500, 502, 503]) expect(classify(op, new ApiError('x', s))).toBe('retry');
  });
  it('drops what the server rejects as invalid, so it cannot block the queue forever', () => {
    expect(classify(op, new ApiError('bad', 400))).toBe('drop');
    expect(classify(op, new ApiError('forbidden', 403))).toBe('drop');
  });
  it('a delete of something already gone is done', () => {
    expect(classify({ id: 'd', kind: 'bookmark.delete', bookmarkId: 'b', at: at() }, new ApiError('nf', 404))).toBe('done');
  });
});

function memoryQueue(initial: OutboxOp[]) {
  let ops = [...initial];
  return {
    load: () => ops,
    save: (next: OutboxOp[]) => {
      ops = next;
    },
    get: () => ops,
    push: (op: OutboxOp) => {
      ops = [...ops, op];
    },
  };
}

describe('drain', () => {
  it('sends in order and empties the queue', async () => {
    const q = memoryQueue([patch('b1', {}), createNote('n1'), patch('b2', {})]);
    const sent: string[] = [];
    const result = await drain(q.load, q.save, async (op) => void sent.push(op.id));
    expect(result.sent).toBe(3);
    expect(q.get()).toEqual([]);
    expect(sent).toHaveLength(3);
  });

  it('stops at the first retryable failure and keeps everything from there (order preserved)', async () => {
    const ops = [patch('b1', {}), createNote('n1'), patch('b2', {})];
    const q = memoryQueue(ops);
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await drain(q.load, q.save, send);
    expect(result).toMatchObject({ sent: 1, stoppedOn: 'Failed to fetch' });
    expect(q.get().map((o) => o.id)).toEqual([ops[1].id, ops[2].id]);
  });

  it('an interrupted sync resumes without sending anything twice', async () => {
    const ops = [patch('b1', {}), createNote('n1')];
    const q = memoryQueue(ops);
    const server: string[] = [];
    // First attempt: the first op lands, then the connection drops.
    await drain(q.load, q.save, async (op) => {
      if (op.kind === 'annotation.create') throw new TypeError('network');
      server.push(op.id);
    });
    // Back online.
    await drain(q.load, q.save, async (op) => void server.push(op.id));
    expect(server).toEqual([ops[0].id, ops[1].id]);
  });

  it('drops a rejected op, reports it, and carries on', async () => {
    const q = memoryQueue([createNote('bad'), patch('b1', {})]);
    const result = await drain(q.load, q.save, async (op) => {
      if (op.kind === 'annotation.create') throw new ApiError('invalid', 400);
    });
    expect(result.dropped).toHaveLength(1);
    expect(result.sent).toBe(1);
    expect(q.get()).toEqual([]);
  });

  it('changes queued while a sync runs are kept and sent', async () => {
    const q = memoryQueue([patch('b1', {})]);
    const late = patch('b2', {});
    const seen: string[] = [];
    await drain(q.load, q.save, async (op) => {
      seen.push(op.id);
      if (seen.length === 1) q.push(late);
    });
    expect(seen).toContain(late.id);
    expect(q.get()).toEqual([]);
  });
});

describe('uuid', () => {
  it('generates RFC 4122 ids the server accepts as row ids', () => {
    const ids = new Set(Array.from({ length: 50 }, uuid));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(isUuid(id)).toBe(true);
    expect(isUuid('an-1699999')).toBe(false);
  });
});
