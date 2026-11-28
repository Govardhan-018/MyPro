/**
 * Everything with a time on it, as one list — what the Calendar and Today's
 * Flow both read.
 *
 * The store is `calendar_events` (events *and* reminders, migration 0025). The
 * one other place a dated reminder can come from is Schedules: a one-off
 * "Remind me" set there, or by the assistant, is mapped into the same shape so
 * it shows on its day and can be edited or deleted from the calendar too. Its
 * row stays in Schedules — that is where its delivery runs — and recurring
 * schedules, AI tasks and emails stay on the Schedules page.
 */
import { useMemo } from 'react';
import type { ScheduleRow } from '@mypro/shared';
import { useCalendar, REMINDER_TONE, type CalEvent, type CalendarState } from './useCalendar';
import { useSchedules, type SchedulesState } from './useSchedules';

/** Prefix that keeps a Schedules row's id from colliding with a calendar id. */
export const SCHEDULE_PREFIX = 'sch:';

/** Whether a Schedules row is a dated reminder the calendar should show. */
export function isCalendarSchedule(row: ScheduleRow): boolean {
  return row.action_type === 'notify' && row.recurrence === 'once' && Boolean(row.run_at);
}

/** A one-off Schedules reminder, as a calendar item. */
export function scheduleToEvent(row: ScheduleRow): CalEvent {
  const payload = row.action_payload ?? {};
  const body = typeof payload.body === 'string' && payload.body.trim() ? payload.body.trim() : '';
  const ran = row.last_run?.status === 'success';
  return {
    id: `${SCHEDULE_PREFIX}${row.id}`,
    scheduleId: row.id,
    source: 'schedule',
    kind: 'reminder',
    title: body || row.name,
    startsAt: row.run_at ?? '',
    allDay: false,
    tone: REMINDER_TONE,
    // A delivered reminder has nothing left to do: show it as done.
    completedAt: ran ? row.last_run?.ran_at : undefined,
    leadMinutes: 0,
    paused: !row.enabled,
  };
}

/** Merge and order: all-day first on a day, then by time. */
export function mergeAgenda(events: CalEvent[], schedules: ScheduleRow[]): CalEvent[] {
  return [...events, ...schedules.filter(isCalendarSchedule).map(scheduleToEvent)].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
}

export interface AgendaState {
  items: CalEvent[];
  loading: boolean;
  error: string | null;
  calendar: CalendarState;
  schedules: SchedulesState;
  /** The Schedules row behind a calendar item, when it came from there. */
  scheduleFor: (item: CalEvent) => ScheduleRow | undefined;
}

export function useAgenda(focus: Date): AgendaState {
  const calendar = useCalendar(focus);
  const schedules = useSchedules(true);
  const items = useMemo(
    () => mergeAgenda(calendar.events, schedules.items),
    [calendar.events, schedules.items],
  );
  return {
    items,
    loading: calendar.loading,
    // A Schedules failure must not blank the calendar; it surfaces on its page.
    error: calendar.error,
    calendar,
    schedules,
    scheduleFor: (item) =>
      item.scheduleId ? schedules.items.find((row) => row.id === item.scheduleId) : undefined,
  };
}

/** Order one day's items for display: all-day first, then chronological. */
export function dayOrder(items: CalEvent[]): CalEvent[] {
  return [...items].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.startsAt.localeCompare(b.startsAt);
  });
}
