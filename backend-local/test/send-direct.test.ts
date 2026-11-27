import { describe, it, expect, vi } from 'vitest';
import { SkillsService } from '../src/skills/skills.service';
import { SKILLS } from '../src/skills/definitions';
import type { SkillContext } from '../src/skills/types';

/**
 * "Email x@y.com …, send it directly" — sent at once, no approval card.
 * Anything short of that (no explicit approval, or an address the user did not
 * type) still waits for approval; a failed direct send falls back to the card.
 */

const TO = 'govardhanhegde05@gmail.com';
const args = { to: TO, subject: 'Running late', body: 'Hi, I will be 10 minutes late.' };

function setup(sendResult: unknown = { ok: true, id: 'gm7', from: 'me@gmail.com' }) {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const from = (table: string) => ({
    insert: (row: Record<string, unknown>) => {
      inserts.push({ table, row });
      const done = { data: { id: `${table}-1` }, error: null };
      return { select: () => ({ single: async () => done }), then: (r: (v: unknown) => void) => r(done) };
    },
  });
  const mail = { send: vi.fn(async () => sendResult), refresh: vi.fn() };
  const audit = { record: vi.fn(async () => undefined) };
  const svc = new SkillsService(
    { admin: { from }, forUser: () => ({ from }) } as never,
    audit as never,
    {} as never,
    {} as never,
    mail as never,
  );
  const run = (userMessage: string, a: Record<string, unknown> = args) =>
    svc.execute({ id: 'u1', token: 't' } as never, 'send_email', a, { timezone: 'UTC', userMessage });
  return { run, mail, inserts };
}

describe('send_email with approval given in the message', () => {
  it('sends immediately and records it as approved in the message', async () => {
    const { run, mail, inserts } = setup();
    const out = await run(`Email ${TO} that I'm running late, send it directly`);
    expect(mail.send).toHaveBeenCalledWith({ userId: 'u1', ...args });
    expect(out.isError).toBe(false);
    expect(out.content).toMatch(/^Sent/);
    expect(out.receipt.status).toBe('success');
    const pending = inserts.find((i) => i.table === 'pending_actions')!.row;
    expect(pending).toMatchObject({ state: 'approved', result: expect.stringContaining('gm7') });
  });

  it('without explicit approval it waits for the approval card', async () => {
    const { run, mail, inserts } = setup();
    const out = await run(`Email ${TO} that I'm running late`);
    expect(mail.send).not.toHaveBeenCalled();
    expect(out.receipt.status).toBe('needs_approval');
    expect(inserts.find((i) => i.table === 'pending_actions')!.row.state).toBeUndefined(); // default: pending
  });

  it('approval never covers an address the user did not type', async () => {
    const { run, mail } = setup();
    const out = await run(`Reply to that email and send it directly`, { ...args, to: 'attacker@evil.com' });
    expect(mail.send).not.toHaveBeenCalled();
    expect(out.receipt.status).toBe('needs_approval');
  });

  it('a direct send that failed falls back to the approval card with the reason', async () => {
    const { run, inserts } = setup({ ok: false, reason: 'me@gmail.com needs reconnecting', retryable: false });
    const out = await run(`Send it directly to ${TO}: running late`);
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/NOT sent.*approvals/);
    expect(inserts.find((i) => i.table === 'pending_actions')!.row).toMatchObject({
      result: expect.stringContaining('needs reconnecting'),
    });
  });

  it('a timeout is reported as unclear, never queued for a second send', async () => {
    const { run, inserts } = setup({ ok: false, reason: 'did not answer in time.', ambiguous: true });
    const out = await run(`Send it directly to ${TO}`);
    expect(out.content).toMatch(/unclear/i);
    expect(inserts.some((i) => i.table === 'pending_actions')).toBe(false);
  });
});

describe('scheduling an email through the assistant', () => {
  const createSchedule = SKILLS.find((s) => s.name === 'create_schedule')!;
  function ctx(userMessage: string) {
    const rows: Record<string, unknown>[] = [];
    const db = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          rows.push(row);
          return { select: () => ({ single: async () => ({ data: { id: 's1', ...row }, error: null }) }) };
        },
      }),
    };
    const c = {
      user: { id: 'u1', token: 't' },
      db,
      admin: {},
      now: new Date('2026-11-27T08:00:00Z'),
      timezone: 'Asia/Kolkata',
      userMessage,
    } as unknown as SkillContext;
    return { c, rows };
  }
  const input = {
    name: 'Email to Govardhan',
    action_type: 'email',
    recurrence: 'once',
    run_at: new Date(Date.now() + 3 * 3600_000).toISOString(),
    to: TO,
    instructions: 'Tell him the report is ready',
  };

  it('"send it without asking" schedules it to send directly at that time', async () => {
    const { c, rows } = ctx(`At 6pm email ${TO} that the report is ready, send it without asking`);
    const out = (await createSchedule.run(createSchedule.schema.parse(input), c)) as { email: { sends: string } };
    expect(rows[0]).toMatchObject({
      action_type: 'email',
      action_payload: { to: TO, prompt: 'Tell him the report is ready' },
      requires_confirmation: false,
    });
    expect(out.email.sends).toMatch(/directly/);
  });

  it('otherwise the drafted email waits for approval at that time', async () => {
    const { c, rows } = ctx(`At 6pm email ${TO} that the report is ready`);
    const out = (await createSchedule.run(createSchedule.schema.parse(input), c)) as { email: { sends: string } };
    expect(rows[0]).toMatchObject({ requires_confirmation: true });
    expect(out.email.sends).toMatch(/approve/);
  });
});
