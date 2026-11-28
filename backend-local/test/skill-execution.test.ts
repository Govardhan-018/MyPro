import { describe, it, expect, vi } from 'vitest';
import { SKILLS, orIlike } from '../src/skills/definitions';
import type { Skill, SkillContext } from '../src/skills/types';

/**
 * Phase 12.1 — the skills run.
 *
 * The other skill tests pin down the schemas and the side-effect tiers. This
 * one does what 12.1 actually asks: inject a fake db, call `run(args, ctx)`,
 * and assert the *row written* — the column defaults, the derived values, the
 * conflict targets, and the free-text filters that go to the database. These
 * are the things a schema can't catch and the model can't be blamed for.
 *
 * The fake is a minimal stand-in for the Supabase query builder: every chained
 * call is recorded and the terminal await resolves to a canned result, so a
 * skill's own logic (defaults, next-check-in maths, the notebook it creates
 * for a loose note) is exercised without a database.
 */

const UUID = '00000000-0000-0000-0000-000000000001';
const skill = <A>(name: string): Skill<A> =>
  SKILLS.find((s) => s.name === name) as unknown as Skill<A>;

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  payload?: any;
  upsertOpts?: any;
  filters: Array<{ fn: string; args: unknown[] }>;
  or?: string;
  single: boolean;
  maybeSingle: boolean;
}

function makeDb(
  maybeSingleData: (table: string) => unknown = () => null,
  listData: (table: string) => unknown[] = () => [],
) {
  const calls: Recorded[] = [];

  function from(table: string) {
    const call: Recorded = { table, op: 'select', filters: [], single: false, maybeSingle: false };
    let pushed = false;

    const resolve = () => {
      if (!pushed) {
        calls.push(call);
        pushed = true;
      }
      let data: unknown;
      if (call.maybeSingle) data = maybeSingleData(table);
      else if (call.single) data = { id: UUID };
      else data = listData(table);
      return { data, error: null };
    };

    const builder: any = {};
    const track = (fn: string) =>
      (...args: unknown[]) => {
        call.filters.push({ fn, args });
        return builder;
      };

    builder.select = () => builder;
    builder.insert = (p: unknown) => {
      call.op = 'insert';
      call.payload = p;
      return builder;
    };
    builder.update = (p: unknown) => {
      call.op = 'update';
      call.payload = p;
      return builder;
    };
    builder.upsert = (p: unknown, o: unknown) => {
      call.op = 'upsert';
      call.payload = p;
      call.upsertOpts = o;
      return builder;
    };
    builder.delete = () => {
      call.op = 'delete';
      return builder;
    };
    builder.or = (s: string) => {
      call.or = s;
      return builder;
    };
    for (const fn of ['eq', 'neq', 'gt', 'gte', 'lte', 'is', 'in', 'order', 'limit']) {
      builder[fn] = track(fn);
    }
    builder.single = () => {
      call.single = true;
      return builder;
    };
    builder.maybeSingle = () => {
      call.maybeSingle = true;
      return builder;
    };
    builder.then = (onF: any, onR: any) => Promise.resolve(resolve()).then(onF, onR);
    return builder;
  }

  return { client: { from } as any, calls };
}

const NOW = new Date('2026-11-23T10:00:00.000Z');
const ctxWith = (db: any, over: Partial<SkillContext> = {}): SkillContext =>
  ({
    user: { id: 'user-1', token: 'tok' } as any,
    db,
    admin: { rpc: async () => ({ data: [], error: null }) } as any,
    now: NOW,
    timezone: 'Asia/Kolkata',
    ...over,
  }) as SkillContext;

const only = (calls: Recorded[], table: string) => calls.find((c) => c.table === table)!;

/* ------------------------------------------------------------------ */

describe('get_now', () => {
  it('reports the current instant in the user timezone', async () => {
    const result = (await skill('get_now').run({}, ctxWith(makeDb().client))) as {
      iso: string;
      timezone: string;
      local: string;
    };
    expect(result.iso).toBe(NOW.toISOString());
    expect(result.timezone).toBe('Asia/Kolkata');
    expect(result.local).toBeTruthy();
  });
});

describe('write skills stamp the owner and the right table', () => {
  it('create_event inserts into calendar_events with the user id', async () => {
    const { client, calls } = makeDb();
    await skill('create_event').run(
      { title: 'Dentist', starts_at: '2026-11-24T09:00:00Z' },
      ctxWith(client),
    );
    const c = only(calls, 'calendar_events');
    expect(c.op).toBe('insert');
    expect(c.payload).toMatchObject({ title: 'Dentist', user_id: 'user-1' });
  });

  it('create_task inserts into tasks with the user id', async () => {
    const { client, calls } = makeDb();
    await skill('create_task').run({ title: 'Email the plumber' }, ctxWith(client));
    expect(only(calls, 'tasks').payload).toMatchObject({ title: 'Email the plumber', user_id: 'user-1' });
  });

  it('update_task patches by id and never writes the id into the row', async () => {
    const { client, calls } = makeDb();
    await skill('update_task').run({ id: UUID, status: 'done' }, ctxWith(client));
    const c = only(calls, 'tasks');
    expect(c.op).toBe('update');
    expect(c.payload).toEqual({ status: 'done' });
    expect(c.filters).toContainEqual({ fn: 'eq', args: ['id', UUID] });
  });

  it('delete_event deletes by id and echoes what it removed', async () => {
    const { client, calls } = makeDb();
    const out = (await skill('delete_event').run({ id: UUID }, ctxWith(client))) as { deleted: string };
    expect(only(calls, 'calendar_events').op).toBe('delete');
    expect(out.deleted).toBe(UUID);
  });

  it('send_notification tags the row as an assistant notification', async () => {
    const { client, calls } = makeDb();
    await skill('send_notification').run({ title: 'Leave now' }, ctxWith(client));
    expect(only(calls, 'notifications').payload).toMatchObject({ kind: 'assistant', user_id: 'user-1' });
  });
});

describe('add_library_item defaults', () => {
  it('defaults an un-statused item to "want" and stamps accessed_at', async () => {
    const { client, calls } = makeDb();
    await skill('add_library_item').run({ type: 'book', title: 'Deep Work' }, ctxWith(client));
    const row = only(calls, 'library_items').payload;
    expect(row.status).toBe('want');
    expect(row.accessed_at).toBe(NOW.toISOString());
  });
});

describe('save_note', () => {
  it('files a loose note under a single auto-created notebook', async () => {
    // maybeSingle returns null → the "Notes with MyPro" notebook does not yet exist
    const { client, calls } = makeDb(() => null);
    await skill('save_note').run({ body: 'a thought' }, ctxWith(client));

    const libWrites = calls.filter((c) => c.table === 'library_items' && c.op === 'insert');
    expect(libWrites).toHaveLength(1);
    expect(libWrites[0].payload).toMatchObject({ type: 'note', title: 'Notes with MyPro' });

    const note = only(calls, 'annotations');
    expect(note.op).toBe('insert');
    expect(note.payload).toMatchObject({ kind: 'note', library_item_id: UUID, user_id: 'user-1' });
  });

  it('reuses an existing library item when given one, writing no notebook', async () => {
    const { client, calls } = makeDb(() => ({ id: 'given-item' }));
    await skill('save_note').run({ body: 'x', library_item_id: UUID }, ctxWith(client));
    expect(calls.some((c) => c.table === 'library_items' && c.op === 'insert')).toBe(false);
    expect(only(calls, 'annotations').payload.library_item_id).toBe(UUID);
  });
});

describe('open_thread', () => {
  it('inserts a new thread with a defaulted kind when none is live', async () => {
    const { client, calls } = makeDb(() => null);
    await skill('open_thread').run({ title: 'Job search' }, ctxWith(client));
    const insert = calls.find((c) => c.table === 'attention_threads' && c.op === 'insert')!;
    expect(insert.payload).toMatchObject({ title: 'Job search', kind: 'other', user_id: 'user-1' });
  });

  it('refreshes the existing thread instead of duplicating it', async () => {
    const { client, calls } = makeDb(() => ({ id: 'live-thread' }));
    await skill('open_thread').run({ title: 'Job search', summary: 'two offers' }, ctxWith(client));
    const update = calls.find((c) => c.table === 'attention_threads' && c.op === 'update')!;
    expect(update.payload).toMatchObject({ state: 'active', summary: 'two offers' });
    expect(calls.some((c) => c.table === 'attention_threads' && c.op === 'insert')).toBe(false);
  });
});

describe('remember upserts on the stable key', () => {
  it('defaults confidence and conflicts on user_id,key', async () => {
    const { client, calls } = makeDb();
    await skill('remember').run({ key: 'work_rhythm', value: 'mornings' }, ctxWith(client));
    const c = only(calls, 'assistant_memory');
    expect(c.op).toBe('upsert');
    expect(c.payload).toMatchObject({ key: 'work_rhythm', confidence: 0.8, source: 'assistant' });
    expect(c.upsertOpts).toEqual({ onConflict: 'user_id,key' });
  });
});

describe('follow_interest', () => {
  it('maps interest level to a threshold and conflicts on the identity', async () => {
    const { client, calls } = makeDb();
    await skill('follow_interest').run(
      { entity: '  Anthropic  ', category: 'company', interest_level: 3 },
      ctxWith(client),
    );
    const c = only(calls, 'interests');
    expect(c.op).toBe('upsert');
    expect(c.payload.entity).toBe('Anthropic'); // trimmed
    expect(c.payload.notify).toBe('chat'); // defaulted
    expect(c.payload.importance_threshold).toBeCloseTo(0.64, 5); // 1 - 3*0.12
    expect(c.upsertOpts).toEqual({ onConflict: 'user_id,category,entity' });
  });
});

describe('update_interest', () => {
  it('deletes when asked to remove', async () => {
    const { client, calls } = makeDb(() => ({ id: UUID }));
    const out = (await skill('update_interest').run({ id: UUID, remove: true }, ctxWith(client))) as {
      removed: boolean;
    };
    expect(out.removed).toBe(true);
    expect(only(calls, 'interests').op).toBe('delete');
  });

  it('refuses an update that would change nothing', async () => {
    const { client } = makeDb();
    await expect(skill('update_interest').run({ id: UUID }, ctxWith(client))).rejects.toThrow(
      /nothing to change/i,
    );
  });
});

describe('create_schedule', () => {
  it('formats the local time and seeds next_run_at with the first real occurrence', async () => {
    const { client, calls } = makeDb();
    await skill('create_schedule').run(
      { name: 'Morning brief', action_type: 'report', recurrence: 'daily', time_of_day: '08:30' },
      ctxWith(client),
    );
    const row = only(calls, 'assistant_schedules').payload;
    expect(row.time_of_day).toBe('08:30:00');
    expect(row.timezone).toBe('Asia/Kolkata');
    // Not "now" (that fired a morning brief the moment it was created): the
    // next 08:30 in the user's zone. NOW is 15:30 IST, so tomorrow 08:30 IST.
    expect(row.next_run_at).toBe('2026-11-24T03:00:00.000Z');
  });

  it('writes de-duplicated weekday rows for a weekly schedule', async () => {
    const { client, calls } = makeDb();
    await skill('create_schedule').run(
      { name: 'Standup', action_type: 'notify', recurrence: 'weekly', days: [1, 1, 3], text: 'go' },
      ctxWith(client),
    );
    const days = calls.find((c) => c.table === 'assistant_schedule_days')!;
    expect(days.op).toBe('insert');
    expect(days.payload).toHaveLength(2); // [1, 3], the duplicate dropped
    expect((days.payload as any[]).map((d) => d.day_of_week).sort()).toEqual([1, 3]);
  });
});

/* ------------------------------------------------------------------ */
/* the free-text filter bug (fixed): a query with a comma or paren used */
/* to split PostgREST's or=(…) grammar into broken fragments.           */
/* ------------------------------------------------------------------ */

describe('free-text search builds a safe or() filter', () => {
  const nasty = 'that book, the one (by Cal)';

  it('search_library quotes the pattern so a comma cannot split it', async () => {
    const { client, calls } = makeDb();
    await skill('search_library').run({ query: nasty }, ctxWith(client));
    const or = only(calls, 'library_items').or!;
    expect(or).toBe(orIlike(nasty, ['title', 'creator']));
    // the user's comma lives inside quotes, so it is not a condition separator
    expect(or).toContain(`"%${nasty}%"`);
  });

  it('search_knowledge covers title, body and anchor_text', async () => {
    const { client, calls } = makeDb();
    await skill('search_knowledge').run({ query: nasty }, ctxWith(client));
    expect(only(calls, 'annotations').or).toBe(orIlike(nasty, ['title', 'body', 'anchor_text']));
  });

  it('search_emails covers subject, from and snippet', async () => {
    const { client, calls } = makeDb(undefined, (t) => (t === 'gmail_accounts' ? [{ id: 'g1' }] : []));
    await skill('search_emails').run({ query: nasty }, ctxWith(client));
    expect(only(calls, 'email_messages').or).toBe(orIlike(nasty, ['subject', 'from_addr', 'snippet']));
  });
});

describe('orIlike', () => {
  it('produces one quoted ilike condition per column', () => {
    expect(orIlike('cal', ['title', 'creator'])).toBe('title.ilike."%cal%",creator.ilike."%cal%"');
  });

  it('escapes a double quote and a backslash so the grammar cannot be escaped', () => {
    expect(orIlike('a"b\\c', ['t'])).toBe('t.ilike."%a\\"b\\\\c%"');
  });

  it('keeps a comma and parens literal inside the quotes', () => {
    const out = orIlike('x, y (z)', ['t']);
    expect(out).toBe('t.ilike."%x, y (z)%"');
  });
});

/* ------------------------------------------------------------------ */
/* email skills: say why there is nothing, refresh before reading       */
/* ------------------------------------------------------------------ */

describe('email skills', () => {
  it('with no mailbox connected, say so instead of an unexplained empty list', async () => {
    const { client } = makeDb();
    const out = (await skill('list_emails').run({}, ctxWith(client))) as { messages: unknown[]; note: string };
    expect(out.messages).toEqual([]);
    expect(out.note).toMatch(/No Gmail account is connected/);
  });

  it('refreshes the mailbox through render before reading it', async () => {
    const { client, calls } = makeDb(undefined, (t) =>
      t === 'gmail_accounts' ? [{ id: 'g1' }] : t === 'email_messages' ? [{ id: 'm1', subject: 'Hi' }] : [],
    );
    const refresh = vi.fn(async () => ({ ok: true }));
    const out = await skill('list_emails').run({}, { ...ctxWith(client), mail: { refresh } });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(out).toEqual([{ id: 'm1', subject: 'Hi' }]);
    expect(calls.some((c) => c.table === 'email_messages')).toBe(true);
  });

  it('when the refresh fails, still answers from what is stored and says why', async () => {
    const { client } = makeDb(undefined, (t) => (t === 'gmail_accounts' ? [{ id: 'g1' }] : []));
    const refresh = async () => ({ ok: false, note: 'This mailbox needs reconnecting.' });
    const out = (await skill('list_emails').run({}, { ...ctxWith(client), mail: { refresh } })) as {
      note: string;
    };
    expect(out.note).toBe('This mailbox needs reconnecting.');
  });
});
