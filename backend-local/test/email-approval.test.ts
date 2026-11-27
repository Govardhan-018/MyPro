import { describe, it, expect, vi } from 'vitest';
import { SkillsController } from '../src/skills/skills.module';

/**
 * The email approval flow: nothing is sent until approved; what you approve
 * (including your edits) is exactly what is sent; a double tap sends once; a
 * failed send can be fixed and retried; a send that may have gone out is never
 * blindly resent.
 */

type Row = Record<string, unknown>;

function fakeDb(rows: Row[]) {
  const from = () => {
    let op: 'select' | 'update' = 'select';
    let values: Row = {};
    const filters: [string, unknown][] = [];
    let gtFilter: [string, string] | null = null;
    const match = (r: Row) =>
      filters.every(([k, v]) => r[k] === v) && (!gtFilter || String(r[gtFilter[0]]) > gtFilter[1]);
    const run = () => {
      const hit = rows.filter(match);
      if (op === 'update') hit.forEach((r) => Object.assign(r, values));
      return { data: hit, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (v: Row) => ((op = 'update'), (values = v), b),
      eq: (k: string, v: unknown) => (filters.push([k, v]), b),
      gt: (k: string, v: string) => ((gtFilter = [k, v]), b),
      order: () => b,
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return b;
  };
  return { forUser: () => ({ from }), admin: { from } };
}

const user = { id: 'u1', token: 't' } as never;
const draft = () => ({
  id: 'p1',
  skill: 'send_email',
  args: { to: 'priya@example.com', subject: 'Thanks', body: 'Hi Priya, thank you.' },
  state: 'pending',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  result: null as string | null,
});

function setup(sendResult: unknown = { ok: true, id: 'gm1', from: 'me@gmail.com' }) {
  const rows: Row[] = [draft()];
  const mail = { send: vi.fn(async () => sendResult) };
  const audit = { record: vi.fn(async () => undefined) };
  const ctrl = new SkillsController({} as never, fakeDb(rows) as never, mail as never, audit as never);
  return { rows, mail, ctrl };
}

describe('approving an email', () => {
  it('sends exactly the drafted email, then records it as sent', async () => {
    const { rows, mail, ctrl } = setup();
    const out = await ctrl.approve(user, 'p1', {});
    expect(out).toMatchObject({ ok: true, executed: true, id: 'gm1' });
    expect(mail.send).toHaveBeenCalledWith({
      userId: 'u1',
      to: 'priya@example.com',
      subject: 'Thanks',
      body: 'Hi Priya, thank you.',
    });
    expect(rows[0]).toMatchObject({ state: 'approved', result: expect.stringContaining('gm1') });
  });

  it('sends your edits, and stores the edited email as what was approved', async () => {
    const { rows, mail, ctrl } = setup();
    await ctrl.approve(user, 'p1', { subject: 'Thank you!', body: 'Edited text.' });
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Thank you!', body: 'Edited text.' }));
    expect((rows[0].args as Row).subject).toBe('Thank you!');
  });

  it('a double tap sends once', async () => {
    const { mail, ctrl } = setup();
    const [a, b] = await Promise.all([ctrl.approve(user, 'p1', {}), ctrl.approve(user, 'p1', {})]);
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it('a send that certainly failed goes back to the queue with the reason, and can be retried', async () => {
    const { rows, mail, ctrl } = setup({ ok: false, reason: 'me@gmail.com needs reconnecting', retryable: false });
    const out = await ctrl.approve(user, 'p1', {});
    expect(out).toMatchObject({ ok: false, retry: true });
    expect(rows[0]).toMatchObject({ state: 'pending', result: expect.stringContaining('needs reconnecting') });

    mail.send.mockResolvedValueOnce({ ok: true, id: 'gm2', from: 'me@gmail.com' } as never);
    expect(await ctrl.approve(user, 'p1', {})).toMatchObject({ ok: true, executed: true });
    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  it('a send that may have gone out (timeout) is never offered for a blind resend', async () => {
    const { rows, ctrl } = setup({ ok: false, reason: 'did not answer in time', ambiguous: true });
    await ctrl.approve(user, 'p1', {});
    expect(rows[0].state).toBe('approved');
    expect(await ctrl.approve(user, 'p1', {})).toMatchObject({ ok: false, reason: 'Already approved.' });
  });

  it('an expired request cannot be approved', async () => {
    const { rows, mail, ctrl } = setup();
    rows[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await ctrl.approve(user, 'p1', {})).toMatchObject({ ok: false, reason: expect.stringMatching(/expired/) });
    expect(mail.send).not.toHaveBeenCalled();
    expect(rows[0].state).toBe('expired');
  });

  it('invalid edits are refused before anything is sent', async () => {
    const { mail, ctrl } = setup();
    await expect(ctrl.approve(user, 'p1', { to: 'not-an-address' })).rejects.toThrow(/not valid/);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('discard never touches a request that is already being sent', async () => {
    const { rows, ctrl } = setup();
    rows[0].state = 'approved';
    await ctrl.reject(user, 'p1');
    expect(rows[0].state).toBe('approved');
  });
});
