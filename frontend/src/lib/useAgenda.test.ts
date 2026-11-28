import { describe, it, expect } from 'vitest';
import type { ScheduleRow } from '@mypro/shared';
import { dayOrder, isCalendarSchedule, mergeAgenda, scheduleToEvent } from './useAgenda';
import type { CalEvent } from './useCalendar';

const schedule = (over: Partial<ScheduleRow>): ScheduleRow =>
  ({
    id: 's1',
    name: 'Take vitamins',
    action_type: 'notify',
    action_payload: { title: 'Reminder', body: 'Take vitamins' },
    channel: 'push',
    recurrence: 'once',
    run_at: '2026-12-01T15:00:00.000Z',
    timezone: 'UTC',
    enabled: true,
    requires_confirmation: false,
    next_run_at: null,
    last_run_at: null,
    ...over,
  }) as ScheduleRow;

describe('Schedules reminders on the calendar', () => {
  it('only one-off "Remind me" rows belong on the calendar', () => {
    expect(isCalendarSchedule(schedule({}))).toBe(true);
    expect(isCalendarSchedule(schedule({ recurrence: 'daily', run_at: null }))).toBe(false);
    expect(isCalendarSchedule(schedule({ action_type: 'chat_message' }))).toBe(false);
    expect(isCalendarSchedule(schedule({ action_type: 'email' }))).toBe(false);
  });

  it('maps to a reminder keyed apart from calendar ids', () => {
    expect(scheduleToEvent(schedule({}))).toMatchObject({
      id: 'sch:s1',
      scheduleId: 's1',
      source: 'schedule',
      kind: 'reminder',
      title: 'Take vitamins',
      startsAt: '2026-12-01T15:00:00.000Z',
      leadMinutes: 0,
      paused: false,
    });
  });

  it('a delivered reminder reads as done; a disabled one as paused', () => {
    const ran = scheduleToEvent(
      schedule({ last_run: { status: 'success', detail: null, ran_at: '2026-12-01T15:00:05Z' } }),
    );
    expect(ran.completedAt).toBe('2026-12-01T15:00:05Z');
    expect(scheduleToEvent(schedule({ enabled: false })).paused).toBe(true);
  });

  it('merges both sources in time order', () => {
    const ev = { id: 'e1', title: 'Gym', startsAt: '2026-12-01T12:00:00.000Z', allDay: false, tone: 'mint' } as CalEvent;
    const merged = mergeAgenda([ev], [schedule({}), schedule({ id: 's2', recurrence: 'daily' })]);
    expect(merged.map((i) => i.id)).toEqual(['e1', 'sch:s1']);
  });

  it('dayOrder puts all-day items first', () => {
    const a = { id: 'a', title: 'a', startsAt: '2026-12-01T08:00:00Z', allDay: false, tone: 'x' } as CalEvent;
    const b = { id: 'b', title: 'b', startsAt: '2026-12-01T00:00:00Z', allDay: true, tone: 'x' } as CalEvent;
    expect(dayOrder([a, b]).map((i) => i.id)).toEqual(['b', 'a']);
  });
});
