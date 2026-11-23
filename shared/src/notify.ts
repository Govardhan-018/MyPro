/**
 * Notification presentation — the pure logic the native clock leans on.
 *
 * The phone arms one OS notification per {@link ScheduleOccurrence} the server
 * returns (`/schedules/upcoming`). *How* each one looks and *where* a tap lands
 * is decided here, not in the device code, so it is one testable place rather
 * than scattered through `expo-notifications` calls:
 *
 *  - {@link notificationChannelFor} picks the Android channel, so the user can
 *    tune event reminders and briefs separately — the way a well-behaved app
 *    lets you.
 *  - {@link notificationHash} builds the in-app route a tap should open,
 *    down to the specific calendar event, matching the web app's hash router.
 *
 * None of this imports a platform module, so it runs in a plain Node test.
 */
import type { ScheduleOccurrence } from './types';

/**
 * The app sections a notification may point at. The single source of truth for
 * both the web (service-worker deep links) and the native shell (tap routing),
 * because the value always originates from a notification payload and a bare
 * whitelist is the whole validation. `today` is the home view.
 */
export const NOTIFICATION_VIEWS = [
  'today',
  'calendar',
  'library',
  'knowledge',
  'health',
  'commitments',
  'schedules',
  'assistant',
  'settings',
] as const;

export type NotificationView = (typeof NOTIFICATION_VIEWS)[number];

/**
 * Turn a server-set deeplink path (e.g. `/assistant`, used by push payloads)
 * into the web app's router hash. Today/home is the empty hash. An unknown
 * target falls back to home rather than guessing.
 */
export function hashFromDeeplink(deeplink: string | null | undefined): string {
  if (!deeplink) return '';
  const seg = deeplink.replace(/^[#/]+/, '').split(/[?#]/)[0];
  if (seg === '' || seg === 'today' || seg === 'home') return '';
  return (NOTIFICATION_VIEWS as readonly string[]).includes(seg) ? seg : '';
}

/** The Android notification channels the app defines. */
export type NotificationChannel = 'reminders' | 'briefs';

type OccurrenceLike = Pick<
  ScheduleOccurrence,
  'kind' | 'action_type' | 'deeplink' | 'deeplink_id' | 'deeplink_at'
>;

/**
 * Which channel a moment belongs to. A generated brief/report is its own
 * channel ("Briefs & messages") so it can be muted without losing event
 * reminders, and vice versa.
 */
export function notificationChannelFor(o: Pick<OccurrenceLike, 'action_type'>): NotificationChannel {
  return o.action_type === 'report' ? 'briefs' : 'reminders';
}

/**
 * The web-router hash a tap should open — the "go to the right place" rule.
 *
 *  - a calendar reminder opens Calendar, focused on that event
 *    (`calendar?event=<id>&at=<iso>`), so the day is right and the event sheet
 *    can open;
 *  - a brief/report opens the assistant;
 *  - anything else opens Today (the empty hash).
 *
 * The section is always one of the known views, because the value ultimately
 * came from a notification payload.
 */
export function notificationHash(o: OccurrenceLike): string {
  const section = o.deeplink ?? (o.action_type === 'report' ? 'assistant' : 'today');
  if (section === 'calendar' && o.deeplink_id) {
    const params = new URLSearchParams({ event: o.deeplink_id });
    if (o.deeplink_at) params.set('at', o.deeplink_at);
    return `calendar?${params.toString()}`;
  }
  // Today is the app's home — the empty hash, not the string "today".
  return section === 'today' ? '' : section;
}
