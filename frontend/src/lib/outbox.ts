/**
 * The offline outbox — every reading/listening change goes through here.
 *
 * Writes used to be fire-and-forget (`.catch(() => {})`): progress, notes and
 * bookmarks made offline, or while Render was waking up, were silently lost.
 * Now each change is appended to a durable queue (localStorage, scoped to the
 * signed-in user — it survives refresh, app kill and the Android WebView being
 * reclaimed) and drained in order when there is a connection.
 *
 *  - **Only the change** is queued (one item's fields, one annotation), never
 *    the book; repeated progress for one item collapses to the latest.
 *  - **At-least-once, never duplicated:** an op leaves the queue only after
 *    the server accepted it, and creates carry a client uuid the server
 *    de-duplicates on (`insertOnce` / bookmark upsert). A sync interrupted
 *    mid-way simply resumes.
 *  - **Conflicts:** progress carries `position_at` (when it was recorded);
 *    render keeps the newest across devices (`isStalePosition`).
 *
 * The queue logic (`enqueue`, `drain`, `classify`) is pure and unit-tested.
 */
import { ApiError, api } from './api';
import { isApiConfigured } from './env';

export type OutboxOp =
  | { id: string; kind: 'library.patch'; itemId: string; body: Record<string, unknown>; at: string }
  | { id: string; kind: 'annotation.create'; itemId: string; body: Record<string, unknown> & { id: string }; at: string }
  | { id: string; kind: 'annotation.delete'; annotationId: string; at: string }
  | { id: string; kind: 'bookmark.create'; itemId: string; body: { id: string; page: number; title?: string }; at: string }
  | { id: string; kind: 'bookmark.delete'; bookmarkId: string; at: string }
  | {
      id: string;
      kind: 'session';
      itemId: string;
      table: 'reading' | 'listening';
      body: Record<string, unknown> & { id: string };
      at: string;
    };

/** Distributes Omit over the union, so each variant keeps its own fields. */
export type NewOutboxOp = OutboxOp extends infer O ? (O extends OutboxOp ? Omit<O, 'id' | 'at'> : never) : never;

/** A uuid, from the platform when it has one. */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 v4 from getRandomValues (older WebViews).
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

function mergePatch(older: Record<string, unknown>, newer: Record<string, unknown>) {
  const a = (older.details ?? {}) as Record<string, unknown>;
  const b = (newer.details ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...older, ...newer };
  if (older.details || newer.details) merged.details = { ...a, ...b };
  // The position's timestamp is the newest one that carried a position.
  merged.position_at = newer.position_at ?? older.position_at;
  if (merged.position_at === undefined) delete merged.position_at;
  return merged;
}

/**
 * Add an op, collapsing what no longer needs sending. Pure.
 *  - Successive patches of one item merge into one (latest values win).
 *  - Deleting something still waiting to be created cancels both.
 */
export function enqueue(queue: OutboxOp[], op: OutboxOp): OutboxOp[] {
  if (op.kind === 'library.patch') {
    const i = queue.findIndex((q) => q.kind === 'library.patch' && q.itemId === op.itemId);
    if (i !== -1) {
      const prev = queue[i] as Extract<OutboxOp, { kind: 'library.patch' }>;
      const next = [...queue];
      next[i] = { ...prev, body: mergePatch(prev.body, op.body), at: op.at };
      return next;
    }
  }
  if (op.kind === 'annotation.delete') {
    const i = queue.findIndex((q) => q.kind === 'annotation.create' && q.body.id === op.annotationId);
    if (i !== -1) return queue.filter((_, n) => n !== i);
  }
  if (op.kind === 'bookmark.delete') {
    const i = queue.findIndex((q) => q.kind === 'bookmark.create' && q.body.id === op.bookmarkId);
    if (i !== -1) return queue.filter((_, n) => n !== i);
  }
  return [...queue, op];
}

/** What a failed send means for the queue. */
export type Verdict = 'retry' | 'drop' | 'done';

/**
 * Network trouble, a waking server, rate limits and an auth hiccup are worth
 * retrying; a request the server rejects as invalid never will succeed, so it
 * is dropped (and reported) instead of blocking everything behind it. A
 * delete of something already gone is simply done.
 */
export function classify(op: OutboxOp, error: unknown): Verdict {
  if (!(error instanceof ApiError)) return 'retry'; // fetch failed / offline
  const s = error.status;
  if (s === 404 && (op.kind === 'annotation.delete' || op.kind === 'bookmark.delete')) return 'done';
  if (s === 0 || s === 401 || s === 408 || s === 425 || s === 429 || s >= 500) return 'retry';
  return 'drop';
}

export interface DrainResult {
  sent: number;
  dropped: { op: OutboxOp; reason: string }[];
  /** Set when draining stopped early on a retryable failure. */
  stoppedOn: string | null;
}

/**
 * Send queued ops in order. The queue is re-read and re-written around every
 * op (`load`/`save`), so ops added meanwhile are kept and a crash mid-drain
 * loses nothing. Stops at the first retryable failure to preserve order.
 */
export async function drain(
  load: () => OutboxOp[],
  save: (ops: OutboxOp[]) => void,
  send: (op: OutboxOp) => Promise<unknown>,
  onSent?: (op: OutboxOp, result: unknown) => void,
): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, dropped: [], stoppedOn: null };
  for (;;) {
    const op = load()[0];
    if (!op) return result;
    let verdict: Verdict = 'done';
    let outcome: unknown;
    try {
      outcome = await send(op);
    } catch (error) {
      verdict = classify(op, error);
      if (verdict === 'retry') {
        result.stoppedOn = error instanceof Error ? error.message : String(error);
        return result;
      }
      if (verdict === 'drop') {
        result.dropped.push({ op, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    // Remove exactly this op (by id) — not "the first", which may have changed.
    save(load().filter((q) => q.id !== op.id));
    if (verdict === 'done') {
      result.sent += 1;
      onSent?.(op, outcome);
    }
  }
}

/* ------------------------------------------------------------------ */
/* runtime: one outbox per signed-in user                               */
/* ------------------------------------------------------------------ */

export interface OutboxStatus {
  pending: number;
  syncing: boolean;
  online: boolean;
  lastError: string | null;
  lastSyncedAt: string | null;
  /** Changes the server refused for good (shown once, never retried). */
  rejected: number;
}

const SESSION_KEY = 'mypro.session';

/** The signed-in user's id, read synchronously from the stored session. */
function currentUserId(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? ((JSON.parse(raw) as { user?: { id?: string } }).user?.id ?? null) : null;
  } catch {
    return null;
  }
}

const keyFor = (uid: string) => `mypro.outbox.${uid}`;

function readQueue(uid: string | null): OutboxOp[] {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(keyFor(uid));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as OutboxOp[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(uid: string | null, ops: OutboxOp[]): void {
  if (!uid) return;
  try {
    if (ops.length) localStorage.setItem(keyFor(uid), JSON.stringify(ops));
    else localStorage.removeItem(keyFor(uid));
  } catch {
    /* storage full: the in-flight op still sends; the rest retry from memory */
  }
}

function sendOp(op: OutboxOp): Promise<unknown> {
  switch (op.kind) {
    case 'library.patch':
      return api.library.update(op.itemId, op.body);
    case 'annotation.create':
      return api.reader.createAnnotation(op.itemId, op.body as never);
    case 'annotation.delete':
      return api.reader.deleteAnnotation(op.annotationId);
    case 'bookmark.create':
      return api.reader.createBookmark(op.itemId, op.body);
    case 'bookmark.delete':
      return api.reader.deleteBookmark(op.bookmarkId);
    case 'session':
      return op.table === 'listening'
        ? api.reader.listeningSession(op.itemId, op.body)
        : api.reader.readingSession(op.itemId, op.body);
  }
}

type Listener = (status: OutboxStatus) => void;
type AppliedListener = (op: OutboxOp, result: unknown) => void;

const listeners = new Set<Listener>();
const appliedListeners = new Set<AppliedListener>();
let status: OutboxStatus = {
  pending: 0,
  syncing: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  lastError: null,
  lastSyncedAt: null,
  rejected: 0,
};
let running: Promise<void> | null = null;
let again = false;
let timer: number | undefined;
let retryTimer: number | undefined;
let retryDelay = 5_000;

function publish(patch: Partial<OutboxStatus>) {
  status = { ...status, ...patch, pending: readQueue(currentUserId()).length };
  for (const l of listeners) l(status);
}

export const outbox = {
  /** Queue a change and try to send it shortly. */
  push(op: NewOutboxOp): void {
    const uid = currentUserId();
    if (!uid || !isApiConfigured) return;
    const full = { ...op, id: uuid(), at: new Date().toISOString() } as OutboxOp;
    writeQueue(uid, enqueue(readQueue(uid), full));
    publish({});
    outbox.flushSoon();
  },

  /** Ops waiting for a given item (so a fresh load does not hide local edits). */
  pendingFor(itemId: string): OutboxOp[] {
    return readQueue(currentUserId()).filter((op) => 'itemId' in op && op.itemId === itemId);
  },

  pendingItemIds(): Set<string> {
    const ids = new Set<string>();
    for (const op of readQueue(currentUserId())) if ('itemId' in op) ids.add(op.itemId);
    return ids;
  },

  flushSoon(delay = 1200): void {
    if (typeof window === 'undefined') return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void outbox.flush(), delay);
  },

  /** Drain now. Single-flight in this tab; serialised across tabs when the platform allows. */
  flush(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    const uid = currentUserId();
    if (!uid || !isApiConfigured) return Promise.resolve();
    running = (async () => {
      do {
        again = false;
        publish({ syncing: true });
        const work = () =>
          drain(
            () => readQueue(uid),
            (ops) => writeQueue(uid, ops),
            sendOp,
            (op, result) => appliedListeners.forEach((l) => l(op, result)),
          );
        const locks = (navigator as Navigator & { locks?: LockManager }).locks;
        const result = locks
          ? await locks.request('mypro-outbox', () => work())
          : await work();
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        publish({
          syncing: false,
          online: !offline,
          lastError: result.stoppedOn,
          lastSyncedAt: result.sent ? new Date().toISOString() : status.lastSyncedAt,
          rejected: status.rejected + result.dropped.length,
        });
        if (result.dropped.length) console.warn('outbox: the server refused', result.dropped);
        window.clearTimeout(retryTimer);
        if (result.stoppedOn && !offline) {
          // Back off while the server is unhappy; "online" retries at once.
          retryTimer = window.setTimeout(() => void outbox.flush(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 5 * 60_000);
        } else {
          retryDelay = 5_000;
        }
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  },

  status(): OutboxStatus {
    return { ...status, pending: readQueue(currentUserId()).length };
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },

  /** Called with each op the server accepted, and what it returned. */
  onApplied(listener: AppliedListener): () => void {
    appliedListeners.add(listener);
    return () => void appliedListeners.delete(listener);
  },
};

let started = false;

/**
 * Wire the triggers once: back online, back to the foreground (the Android
 * shell also sends `mypro:resume`), and on the way to the background (the
 * last chance before the app may be killed). Called from main.tsx.
 */
export function startOutbox(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const kick = () => void outbox.flush();
  window.addEventListener('online', () => {
    publish({ online: true });
    kick();
  });
  window.addEventListener('offline', () => publish({ online: false }));
  window.addEventListener('mypro:resume', kick);
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('pagehide', kick);
  // Another tab changed the queue (or this user's session arrived).
  window.addEventListener('storage', (event) => {
    if (event.key?.startsWith('mypro.outbox.') || event.key === SESSION_KEY) publish({});
  });
  publish({});
  outbox.flushSoon(2_000);
}
