import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * The drain loop end to end, against an in-memory database.
 *
 * What these prove, for each of the three modes:
 *  - a due row is **claimed before** anything outward happens, so two ticks
 *    (or two agents) racing on the same row execute it exactly once;
 *  - an AI message runs the agent as the user and lands in the chat, then
 *    notifies "Done";
 *  - an email is generated, sent once, and a transient failure that certainly
 *    sent nothing is retried — while a timeout (might have sent) is not;
 *  - an email with no send-capable mailbox fails clearly, without retrying.
 */

beforeAll(() => {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxxxxxxxxxxxxxx',
    SUPABASE_SECRET_KEY: 'sb_secret_xxxxxxxxxxxxxxxxxxxxxxxxxx',
    INTERNAL_SERVICE_TOKEN: 'x'.repeat(40),
    SCHEDULER_ENABLED: 'true',
    PORT: '8787',
  });
});

type Row = Record<string, unknown>;

/** A tiny PostgREST look-alike: enough of supabase-js's builder for the scheduler. */
function fakeDb(tables: Record<string, Row[]>) {
  const log: { table: string; op: string; values?: Row }[] = [];
  function builder(table: string) {
    let op = 'select';
    let values: Row | undefined;
    const filters: ((r: Row) => boolean)[] = [];
    let wantRows = false;
    const run = () => {
      const rows = (tables[table] ??= []);
      if (op === 'insert') {
        rows.push({ id: `${table}-${rows.length + 1}`, ...values });
        log.push({ table, op, values });
        return { data: [values], error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        hit.forEach((r) => Object.assign(r, values));
        log.push({ table, op, values });
        return { data: wantRows ? hit : null, error: null };
      }
      return { data: hit, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => ((wantRows = true), b),
      insert: (v: Row) => ((op = 'insert'), (values = v), b),
      update: (v: Row) => ((op = 'update'), (values = v), b),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      neq: () => b,
      not: () => b,
      is: () => b,
      in: () => b,
      gte: () => b,
      lte: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => {
        const out = run();
        return { data: (out.data as Row[] | null)?.[0] ?? null, error: null };
      },
      single: async () => {
        const out = run();
        return { data: (out.data as Row[] | null)?.[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return b;
  }
  return { admin: { from: builder }, log, tables };
}

const SEND = 'https://www.googleapis.com/auth/gmail.send';
const dueAt = new Date(Date.now() - 30_000).toISOString();

function schedule(over: Row): Row {
  return {
    id: 's1',
    user_id: 'u1',
    name: 'Thank Bob',
    channel: 'in_app',
    recurrence: 'once',
    run_at: dueAt,
    time_of_day: null,
    day_of_month: null,
    cron_expr: null,
    timezone: 'UTC',
    enabled: true,
    requires_confirmation: false,
    deferred_count: 0,
    next_run_at: dueAt,
    updated_at: new Date(Date.now() - 3600_000).toISOString(),
    assistant_schedule_days: [],
    ...over,
  };
}

async function makeService(tables: Record<string, Row[]>, over: Partial<Record<string, unknown>> = {}) {
  const { SchedulerService } = await import('../src/scheduler/scheduler.service');
  const db = fakeDb(tables);
  const push = { send: vi.fn(async () => 'n1') };
  const mail = {
    configured: () => true,
    send: vi.fn(async () => ({ ok: true as const, id: 'gm1', from: 'me@gmail.com' })),
    ...((over.mail as object) ?? {}),
  };
  const llm = {
    generate: vi.fn(async () => ({ text: '{"subject":"Thanks","body":"Hi Bob, thank you."}' })),
  };
  const assistant = {
    send: vi.fn(async () => ({ message: { content: 'Here is your summary.' } })),
  };
  const broker = { withUser: vi.fn(async (_id: string, work: (u: unknown) => unknown) => work({ id: 'u1', token: 't' })) };
  const svc = new SchedulerService(
    db as never,
    { record: async () => undefined } as never,
    llm as never,
    push as never,
    assistant as never,
    mail as never,
    broker as never,
  );
  return { svc, db, push, mail, llm, assistant, broker };
}

const runOne = (svc: unknown, row: Row) =>
  (svc as { runOne: (r: Row) => Promise<void> }).runOne(structuredClone(row));

describe('claim before execute', () => {
  it('two ticks racing on the same due email send it exactly once', async () => {
    const row = schedule({ action_type: 'email', action_payload: { to: 'bob@example.com', prompt: 'thank Bob' } });
    const tables = {
      assistant_schedules: [structuredClone(row)],
      gmail_accounts: [{ id: 'g1', user_id: 'u1', email: 'me@gmail.com', scopes: SEND }],
    };
    const { svc, mail } = await makeService(tables);
    await Promise.all([runOne(svc, row), runOne(svc, row)]);
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(tables.assistant_schedules[0].enabled).toBe(false); // a one-off is done
  });
});

describe('AI message', () => {
  it('runs the agent as the user, lands in chat, and notifies when done', async () => {
    const row = schedule({ action_type: 'chat_message', action_payload: { prompt: 'Summarise my day' } });
    const tables = { assistant_schedules: [structuredClone(row)], schedule_runs: [] as Row[] };
    const { svc, assistant, broker, push } = await makeService(tables);
    await runOne(svc, row);
    expect(broker.withUser).toHaveBeenCalledWith('u1', expect.any(Function));
    expect(assistant.send).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      expect.stringContaining('Summarise my day'),
    );
    expect(push.send).toHaveBeenCalledWith('u1', expect.objectContaining({ deeplink: '/assistant' }));
    expect(tables.schedule_runs[0]).toMatchObject({ status: 'success' });
  });

  it('a model outage is retried later rather than failing for good', async () => {
    const row = schedule({ action_type: 'chat_message', action_payload: { prompt: 'news' } });
    const tables = { assistant_schedules: [structuredClone(row)], schedule_runs: [] as Row[] };
    const { svc, broker } = await makeService(tables);
    broker.withUser.mockRejectedValueOnce(new Error('model rate limited (429)'));
    await runOne(svc, row);
    const saved = tables.assistant_schedules[0];
    expect(saved.enabled).toBe(true);
    expect(saved.deferred_count).toBe(1);
    expect(new Date(String(saved.next_run_at)).getTime()).toBeGreaterThan(Date.now());
    expect(tables.schedule_runs[0]).toMatchObject({ status: 'retrying', attempt: 1 });
  });
});

describe('email', () => {
  const payload = { to: 'bob@example.com', prompt: 'thank Bob for lunch' };

  it('writes the email with the AI and sends it from the connected Gmail', async () => {
    const row = schedule({ action_type: 'email', action_payload: payload });
    const tables = {
      assistant_schedules: [structuredClone(row)],
      gmail_accounts: [{ id: 'g1', user_id: 'u1', email: 'me@gmail.com', scopes: SEND }],
      schedule_runs: [] as Row[],
    };
    const { svc, mail } = await makeService(tables);
    await runOne(svc, row);
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'bob@example.com', subject: 'Thanks', body: 'Hi Bob, thank you.' }),
    );
    expect(tables.schedule_runs[0]).toMatchObject({ status: 'success' });
  });

  it('a send that certainly never reached the mail service is retried', async () => {
    const row = schedule({ action_type: 'email', action_payload: payload });
    const tables = {
      assistant_schedules: [structuredClone(row)],
      gmail_accounts: [{ id: 'g1', user_id: 'u1', email: 'me@gmail.com', scopes: SEND }],
      schedule_runs: [] as Row[],
    };
    const { svc } = await makeService(tables, {
      mail: { send: vi.fn(async () => ({ ok: false, reason: 'waking up', retryable: true })) },
    });
    await runOne(svc, row);
    expect(tables.schedule_runs[0]).toMatchObject({ status: 'retrying' });
    expect(tables.assistant_schedules[0].enabled).toBe(true);
  });

  it('a timeout (may have sent) is not retried — no duplicate email', async () => {
    const row = schedule({ action_type: 'email', action_payload: payload });
    const tables = {
      assistant_schedules: [structuredClone(row)],
      gmail_accounts: [{ id: 'g1', user_id: 'u1', email: 'me@gmail.com', scopes: SEND }],
      schedule_runs: [] as Row[],
    };
    const { svc, push } = await makeService(tables, {
      mail: { send: vi.fn(async () => ({ ok: false, reason: 'timeout', retryable: false })) },
    });
    await runOne(svc, row);
    expect(tables.schedule_runs[0]).toMatchObject({ status: 'failed' });
    expect(tables.assistant_schedules[0].enabled).toBe(false);
    expect(push.send).toHaveBeenCalledWith('u1', expect.objectContaining({ title: expect.stringMatching(/failed/) }));
  });

  it('with no send-capable mailbox it fails clearly and does not retry', async () => {
    const row = schedule({ action_type: 'email', action_payload: payload });
    const tables = {
      assistant_schedules: [structuredClone(row)],
      gmail_accounts: [{ id: 'g1', user_id: 'u1', email: 'me@gmail.com', scopes: 'gmail.readonly' }],
      schedule_runs: [] as Row[],
    };
    const { svc, mail } = await makeService(tables);
    await runOne(svc, row);
    expect(mail.send).not.toHaveBeenCalled();
    expect(String(tables.schedule_runs[0].detail)).toMatch(/send access/);
    expect(tables.schedule_runs[0]).toMatchObject({ status: 'failed' });
  });

  it('"ask me first" drafts the email into the approvals queue instead of sending', async () => {
    const row = schedule({ action_type: 'email', action_payload: payload, requires_confirmation: true });
    const tables = {
      assistant_schedules: [structuredClone(row)],
      gmail_accounts: [{ id: 'g1', user_id: 'u1', email: 'me@gmail.com', scopes: SEND }],
      schedule_runs: [] as Row[],
      pending_actions: [] as Row[],
    };
    const { svc, mail } = await makeService(tables);
    await runOne(svc, row);
    expect(mail.send).not.toHaveBeenCalled();
    expect(tables.pending_actions[0]).toMatchObject({ skill: 'send_email' });
    expect(tables.schedule_runs[0]).toMatchObject({ status: 'pending_confirmation' });
  });
});

describe('remind me', () => {
  it('sends the reminder with its own words, marked so the phone copy is not duplicated', async () => {
    const row = schedule({ action_type: 'notify', action_payload: { title: 'Stretch', body: 'Two minutes' } });
    const tables = { assistant_schedules: [structuredClone(row)], schedule_runs: [] as Row[] };
    const { svc, push } = await makeService(tables);
    await runOne(svc, row);
    expect(push.send).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ title: 'Stretch', body: 'Two minutes', localCopy: expect.any(Object) }),
    );
  });
});
