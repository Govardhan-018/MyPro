/**
 * The phone as the clock — Phase 11.2, plus push registration (8.4).
 *
 * This is the file the whole zero-cost architecture rests on. Render's free
 * instance sleeps and the laptop gets shut, but Android's own alarm manager is
 * awake at 08:30 for nothing, so the brief is armed *locally*, ahead of time,
 * and the OS fires it whatever else is off.
 *
 * Two independent mechanisms, and it matters that they are independent:
 *
 *  - **Local notifications** (`armUpcoming`) need no account, no key and no
 *    network at fire time. This is the on-time path, and it works on a plain
 *    `expo prebuild` APK.
 *  - **Push** (`registerForPush`) reaches the phone for things nobody could
 *    predict — an unanswered email, a commitment at risk. It needs an EAS
 *    project id and a Firebase `google-services.json`, so it is allowed to
 *    fail without taking the clock down with it.
 *
 * The phone stays dumb on purpose: it arms, displays and captures. It never
 * computes a recurrence (render expands the occurrences) and never does the
 * work (the laptop does). Android throttles background execution hard, and a
 * phone that tried to be a worker would be a phone that quietly stopped.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import type { ScheduleOccurrence } from '@mypro/shared';
import { client } from './client';

/** How far ahead to arm. Re-armed on every launch, so the window rolls. */
export const ARM_WINDOW_HOURS = 48;

/** Marks our own scheduled notifications so we never cancel someone else's. */
const OWNED = 'mypro:schedule';

/** Foreground behaviour: a notification that arrives while you are looking at
 * the app should still be visible — it is the same information either way. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Android needs a channel before anything can be shown, and the channel
 * carries the importance — without `HIGH` the brief lands silently in the
 * shade, which for a 08:30 notification is the same as not arriving.
 */
export async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'MyPro',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FFFFFF',
  });
}

/**
 * Ask once. Returns whether we may post notifications at all — everything
 * else in this file is pointless without it, and on Android 13+ the user has
 * to say yes explicitly.
 */
export async function ensurePermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  // `canAskAgain === false` means they said no and meant it; re-prompting
  // would be a no-op that looks like a bug.
  if (!existing.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * Arm the next ~48 hours (Phase 11.2).
 *
 * Re-arming replaces rather than adds: every notification we own is cancelled
 * first, then the current occurrence list is scheduled. That is why the
 * occurrence id is derived from the schedule and the instant — editing a
 * schedule changes the ids, so yesterday's plan cannot survive as a ghost.
 *
 * @returns how many notifications are now armed, or null if it could not run.
 */
export async function armUpcoming(): Promise<number | null> {
  if (!(await ensurePermission())) return null;
  await ensureChannel();

  let occurrences: ScheduleOccurrence[];
  try {
    occurrences = await client.api.schedules.upcoming(ARM_WINDOW_HOURS);
  } catch {
    // Render may be asleep or the phone offline. Whatever is already armed
    // stays armed — that is the entire point of arming ahead of time.
    return null;
  }

  await cancelOwned();

  const now = Date.now();
  let armed = 0;

  for (const occurrence of occurrences) {
    const at = new Date(occurrence.at);
    // A moment that has already passed cannot be scheduled; the laptop's
    // drain loop owns anything overdue.
    if (!Number.isFinite(at.getTime()) || at.getTime() <= now + 1000) continue;

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: occurrence.id,
        content: {
          title: occurrence.title || 'MyPro',
          body: occurrence.body ?? bodyFor(occurrence),
          data: {
            owner: OWNED,
            schedule_id: occurrence.schedule_id,
            action_type: occurrence.action_type,
            /* Where tapping it should land. A report opens the brief; a bare
             * reminder has nowhere better to go than Today. */
            deeplink: occurrence.action_type === 'report' ? 'assistant' : 'today',
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at,
          channelId: 'default',
        },
      });
      armed += 1;
    } catch {
      // One bad occurrence must not cost us the other 47.
      continue;
    }
  }

  return armed;
}

/**
 * What to say when the schedule itself carries no body.
 *
 * A `report` is generated by the laptop at the moment it runs, so at arming
 * time there is nothing to quote — the notification promises the brief and
 * the app composes or fetches it when opened (Phase 11.3).
 */
function bodyFor(occurrence: ScheduleOccurrence): string {
  if (occurrence.action_type === 'report') return 'Your brief is ready — tap to read it.';
  return occurrence.name;
}

/** Cancel only what we scheduled, identified by the data we put on it. */
async function cancelOwned(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => (n.content.data as { owner?: string } | null)?.owner === OWNED)
      .map((n) =>
        Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined),
      ),
  );
}

/**
 * Register this device for push (Phase 8.4).
 *
 * Filed under `channel_type: 'fcm'` because that is how it is delivered, but
 * the token is an **Expo** push token: Expo's gateway fronts FCM and needs no
 * server key, which is what keeps this inside the zero-cost rule.
 *
 * It needs an EAS project id, and a standalone APK additionally needs a
 * Firebase `google-services.json`. Neither is set up yet, so this returns a
 * reason instead of throwing — the clock does not depend on it.
 */
export async function registerForPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!Device.isDevice) return { ok: false, reason: 'Push needs a real device, not an emulator.' };
  if (!(await ensurePermission())) return { ok: false, reason: 'Notifications are not allowed.' };
  await ensureChannel();

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
  if (!projectId) {
    return {
      ok: false,
      reason: 'No EAS project id — local notifications still work; push does not.',
    };
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await client.api.devices.register({
      channel_type: 'fcm',
      token,
      platform: `android/${Device.modelName ?? 'unknown'}`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Could not register for push.' };
  }
}
