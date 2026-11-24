import { describe, it, expect } from 'vitest';
import type { ScheduleRow } from '@mypro/shared';
import { buildScheduleInput, emptyScheduleForm, formFromRow, isFormEditable } from './useSchedules';

/**
 * The scheduler form → API mapping (Remind me · AI message · Email). The suite
 * runs in America/New_York (vitest.config.ts), so "local time" is concrete.
 *
 * Pins the original bug: the form wrote every action's words to `prompt`,
 * while the drain loop read a reminder from `title`/`body` — reminders arrived
 * as their bare name.
 */

const NOW = new Date('2026-11-24T15:00:00Z'); // 10:00 in New York
const TZ = 'America/New_York';
const form = (over: Partial<ReturnType<typeof emptyScheduleForm>>) => ({
  ...emptyScheduleForm(NOW),
  ...over,
});

describe('emptyScheduleForm', () => {
  it('defaults to a reminder an hour from now, on a quarter hour, local', () => {
    const f = emptyScheduleForm(NOW);
    expect(f.mode).toBe('notify');
    expect(f.date).toBe('2026-11-24');
    expect(f.time).toBe('11:00');
  });
});

describe('buildScheduleInput', () => {
  it('Remind me → a one-off notify carrying the words where the drain loop reads them', () => {
    const out = buildScheduleInput(form({ text: 'Call the dentist', date: '2026-11-24', time: '16:30' }), TZ, NOW);
    if (!('input' in out)) throw new Error(out.error);
    expect(out.input).toMatchObject({
      action_type: 'notify',
      action_payload: { title: 'Reminder', body: 'Call the dentist' },
      recurrence: 'once',
      timezone: TZ,
      requires_confirmation: false,
    });
    // 16:30 New York (EST, UTC-5) is 21:30Z.
    expect(out.input.run_at).toBe('2026-11-24T21:30:00.000Z');
  });

  it('AI message → the instructions as a prompt for the AI', () => {
    const out = buildScheduleInput(
      form({ mode: 'chat_message', text: 'Summarise the top tech news', repeat: 'daily', time: '08:00' }),
      TZ,
      NOW,
    );
    if (!('input' in out)) throw new Error(out.error);
    expect(out.input).toMatchObject({
      action_type: 'chat_message',
      action_payload: { prompt: 'Summarise the top tech news' },
      recurrence: 'daily',
      time_of_day: '08:00',
    });
    expect(out.input.run_at).toBeUndefined();
  });

  it('Email → destination + instructions; "ask first" only applies to email', () => {
    const out = buildScheduleInput(
      form({ mode: 'email', to: ' bob@example.com ', text: 'Thank Bob for lunch', askFirst: true }),
      TZ,
      NOW,
    );
    if (!('input' in out)) throw new Error(out.error);
    expect(out.input).toMatchObject({
      action_type: 'email',
      action_payload: { to: 'bob@example.com', prompt: 'Thank Bob for lunch' },
      name: 'Email to bob@example.com',
      requires_confirmation: true,
    });
  });

  it('weekly → de-duplicated, sorted days', () => {
    const out = buildScheduleInput(form({ text: 'Gym', repeat: 'weekly', days: [5, 1, 1, 3] }), TZ, NOW);
    if (!('input' in out)) throw new Error(out.error);
    expect(out.input.days).toEqual([1, 3, 5]);
  });

  it('says what is missing, per field', () => {
    expect(buildScheduleInput(form({ text: '  ' }), TZ, NOW)).toMatchObject({ field: 'text' });
    expect(buildScheduleInput(form({ mode: 'email', text: 'x', to: 'bob' }), TZ, NOW)).toMatchObject({
      field: 'to',
    });
    expect(buildScheduleInput(form({ text: 'x', repeat: 'weekly', days: [] }), TZ, NOW)).toMatchObject({
      field: 'days',
    });
  });

  it('refuses a time that has already passed (a one-off would silently never run)', () => {
    const out = buildScheduleInput(form({ text: 'x', date: '2026-11-24', time: '09:00' }), TZ, NOW);
    expect(out).toMatchObject({ field: 'when' });
  });
});

describe('editing', () => {
  const row = (over: Partial<ScheduleRow>): ScheduleRow => ({
    id: 's1',
    name: 'Call the dentist',
    action_type: 'notify',
    action_payload: { title: 'Reminder', body: 'Call the dentist' },
    channel: 'push',
    recurrence: 'once',
    run_at: '2026-11-24T21:30:00.000Z',
    time_of_day: null,
    day_of_month: null,
    cron_expr: null,
    timezone: TZ,
    enabled: true,
    requires_confirmation: false,
    next_run_at: '2026-11-24T21:30:00.000Z',
    last_run_at: null,
    ...over,
  });

  it('round-trips a reminder back into the form, in local time', () => {
    expect(formFromRow(row({}), NOW)).toMatchObject({
      mode: 'notify',
      text: 'Call the dentist',
      date: '2026-11-24',
      time: '16:30',
      repeat: 'once',
    });
  });

  it('round-trips an email, including "ask first"', () => {
    const f = formFromRow(
      row({ action_type: 'email', action_payload: { to: 'a@b.co', prompt: 'hi' }, requires_confirmation: true }),
      NOW,
    );
    expect(f).toMatchObject({ mode: 'email', to: 'a@b.co', text: 'hi', askFirst: true });
  });

  it('the brief and cron/monthly rows are not form-editable (pause/delete only)', () => {
    expect(isFormEditable(row({ action_type: 'report' }))).toBe(false);
    expect(isFormEditable(row({ recurrence: 'cron' }))).toBe(false);
    expect(isFormEditable(row({}))).toBe(true);
  });
});
