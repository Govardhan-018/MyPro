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
import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import {
  notificationChannelFor,
  notificationHash,
  type ScheduleOccurrence,
} from '@mypro/shared';
import { client } from './client';
import { colors } from '../theme';

/**
 * How far ahead to arm: a week (the most `/schedules/upcoming` serves). It
 * used to be 48 hours, so a reminder set for next Friday only reached the
 * phone if the app happened to be opened again in the two days before it.
 * Re-armed on every launch/resume and whenever a schedule changes.
 */
export const ARM_WINDOW_HOURS = 168;

/** Marks our own scheduled notifications so we never cancel someone else's. */
const OWNED = 'mypro:schedule';

/**
 * The brand accent, so the status-bar icon and app name are tinted rather than
 * a flat black square. Sourced from the one theme token (`colors.violet`), not
 * repeated as a literal.
 */
const ACCENT = colors.violet;

/**
 * The channels the app posts on. Two, so the user can tune them apart the way
 * a real app lets you — silence briefs but keep event reminders loud, say.
 * `default` is kept only so notifications armed by an older build still show.
 */
const CHANNELS: Record<string, { name: string; description: string }> = {
  reminders: {
    name: 'Reminders',
    description: 'Calendar events and your standing schedules.',
  },
  briefs: {
    name: 'Briefs & messages',
    description: 'Your morning brief and things the assistant surfaces.',
  },
  default: { name: 'MyPro', description: 'General notifications.' },
};

/** Foreground behaviour: a notification that arrives while you are looking at
 * the app should still be visible — it is the same information either way.
 * HIGH priority so it still drops down as a heads-up banner in the foreground;
 * a sound, because a reminder you do not notice is a reminder that failed. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    priority: Notifications.AndroidNotificationPriority.HIGH,
  }),
});

/**
 * Android needs a channel before anything can be shown, and the channel
 * carries the importance — without `HIGH` the brief lands silently in the
 * shade, which for a 08:30 notification is the same as not arriving.
 */
export async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(
    Object.entries(CHANNELS).map(([id, meta]) =>
      Notifications.setNotificationChannelAsync(id, {
        name: meta.name,
        description: meta.description,
        // HIGH is what makes Android show a heads-up banner (8.0+). Note the
        // OS keeps whatever importance the user last chose for an existing
        // channel — this only sets the default, and never overrides them.
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        enableVibrate: true,
        lightColor: ACCENT,
        // Show on the lock screen, but let the user's own "hide sensitive
        // content" setting redact the text on a secure lock screen. PUBLIC
        // would override that privacy choice; SECRET would hide it entirely.
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
        showBadge: true,
        // Never punch through Do Not Disturb on our own say-so.
        bypassDnd: false,
      }),
    ),
  );
}

/**
 * Ask once. Returns whether we may post notifications at all — everything
 * else in this file is pointless without it, and on Android 13+ the user has
 * to say yes explicitly.
 */
export async function ensurePermission(): Promise<boolean> {
  // Expo's guidance: create the channel before asking, or on some Android
  // versions the permission prompt never appears and the answer is "no".
  await ensureChannel().catch(() => undefined);
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
/** The outcome of the last arming pass, shown in Settings → Notifications. */
export interface ArmResult {
  at: string;
  /** How many notifications are now armed (null when the pass could not run). */
  armed: number | null;
  /** Where the reminder list came from. */
  source: 'web' | 'native';
  /** Why nothing was armed, in words a person can act on. */
  error: string | null;
}
let lastArm: ArmResult | null = null;
export const lastArmResult = () => lastArm;

/**
 * Arm the next week from the phone's own copy of the session (fallback path:
 * cold start before the web app has loaded). The web app normally sends the
 * list itself — see {@link armOccurrences}.
 */
export async function armUpcoming(): Promise<number | null> {
  if (!(await ensurePermission())) {
    lastArm = { at: new Date().toISOString(), armed: null, source: 'native', error: 'Notifications are turned off for MyPro.' };
    return null;
  }
  // Signed out: nothing of anyone's should be armed on this device.
  if (!(await client.auth.getSession())) {
    await cancelOwned();
    return null;
  }

  let occurrences: ScheduleOccurrence[];
  try {
    occurrences = await client.api.schedules.upcoming(ARM_WINDOW_HOURS);
  } catch (err) {
    // Render may be asleep or the phone offline. Whatever is already armed
    // stays armed — that is the entire point of arming ahead of time.
    lastArm = {
      at: new Date().toISOString(),
      armed: null,
      source: 'native',
      error: `Couldn’t fetch your reminders (${err instanceof Error ? err.message : 'network'}).`,
    };
    return null;
  }
  return armOccurrences(occurrences, 'native');
}

/** Only well-formed occurrences from the web bridge are armed. */
function isOccurrence(value: unknown): value is ScheduleOccurrence {
  const o = value as Partial<ScheduleOccurrence> | null;
  return (
    !!o &&
    typeof o.id === 'string' &&
    typeof o.at === 'string' &&
    typeof o.schedule_id === 'string' &&
    typeof o.action_type === 'string'
  );
}

/**
 * Replace everything we armed with this list. Called with the list the web
 * app fetched using its own live session (the reliable path), or with the
 * phone's own fetch above.
 *
 * Re-arming replaces rather than adds: every notification we own is cancelled
 * first, then the current occurrence list is scheduled. That is why the
 * occurrence id is derived from the schedule and the instant — editing a
 * schedule changes the ids, so yesterday's plan cannot survive as a ghost.
 */
export async function armOccurrences(
  list: unknown[],
  source: 'web' | 'native',
): Promise<number | null> {
  if (!(await ensurePermission())) {
    lastArm = { at: new Date().toISOString(), armed: null, source, error: 'Notifications are turned off for MyPro.' };
    return null;
  }
  await ensureChannel();
  const occurrences = list.filter(isOccurrence);

  await cancelOwned();

  const now = Date.now();
  let armed = 0;
  let firstError: string | null = null;

  for (const occurrence of occurrences) {
    const at = new Date(occurrence.at);
    // A moment that has already passed cannot be scheduled; the laptop's
    // drain loop owns anything overdue.
    if (!Number.isFinite(at.getTime()) || at.getTime() <= now + 1000) continue;

    const channelId = notificationChannelFor(occurrence);
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: occurrence.id,
        content: {
          title: occurrence.title || 'MyPro',
          body: occurrence.body ?? bodyFor(occurrence),
          color: ACCENT,
          // Heads-up on Android 7 and below (8+ takes it from the channel).
          priority: Notifications.AndroidNotificationPriority.HIGH,
          sound: 'default',
          autoDismiss: true,
          data: {
            owner: OWNED,
            schedule_id: occurrence.schedule_id,
            action_type: occurrence.action_type,
            /* The exact in-app route a tap opens — section plus, for a calendar
             * reminder, the event itself. Computed once here (shared logic) and
             * carried on the notification so the tap handler is trivial. */
            hash: notificationHash(occurrence),
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at,
          channelId,
        },
      });
      armed += 1;
    } catch (err) {
      // One bad occurrence must not cost us the others — but say why.
      firstError ??= err instanceof Error ? err.message : String(err);
      continue;
    }
  }

  lastArm = {
    at: new Date().toISOString(),
    armed,
    source,
    error: firstError ? `Some reminders could not be scheduled: ${firstError}` : null,
  };
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
 * Fire a notification right now, so the user can confirm on their own phone
 * that notifications are permitted and showing — independent of whether an
 * event happens to be due. Returns why it could not, so the UI can say.
 */
export async function fireTestNotification(): Promise<{ ok: boolean; reason?: string }> {
  if (!(await ensurePermission())) {
    return { ok: false, reason: 'Notifications are turned off for MyPro in Android settings.' };
  }
  await ensureChannel();
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `mypro-test-${Date.now()}`,
      content: {
        title: 'MyPro notifications are on',
        body: 'This is a test. Event reminders and your brief will arrive like this.',
        color: ACCENT,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        sound: 'default',
        data: { owner: OWNED, hash: '' },
      },
      // A small delay rather than null: an immediate trigger can be swallowed
      // while the app is foregrounded on some Android builds.
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 2,
        channelId: 'reminders',
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Could not post a notification.' };
  }
}

/** The Expo push token this device registered with, kept to withdraw it. */
let pushToken: string | null = null;

/**
 * Register this device for push (Phase 8.4).
 *
 * Filed under `channel_type: 'fcm'` because that is how it is delivered, but
 * the token is an **Expo** push token: Expo's gateway fronts FCM and needs no
 * server key, which is what keeps this inside the zero-cost rule.
 *
 * It needs an EAS project id (`EAS_PROJECT_ID` at build time, see
 * `app.config.js`) and a Firebase `google-services.json` in the APK. Without
 * them this returns a reason instead of throwing — the clock does not depend
 * on it, and nothing pretends push works when it cannot.
 *
 * `armedAt` tells the laptop when this device last armed its local reminders,
 * so it never pushes a reminder the phone will already show itself.
 */
export async function registerForPush(armedAt?: Date): Promise<{ ok: boolean; reason?: string }> {
  if (!Device.isDevice) return { ok: false, reason: 'Push needs a real device, not an emulator.' };
  if (!(await ensurePermission())) return { ok: false, reason: 'Notifications are not allowed.' };
  if (!(await client.auth.getSession())) return { ok: false, reason: 'Not signed in.' };
  await ensureChannel();

  const projectId = easProjectId();
  if (!projectId) {
    return {
      ok: false,
      reason: 'Push is not configured in this build — reminders still arrive; instant alerts do not.',
    };
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    pushToken = token;
    await client.api.devices.register({
      channel_type: 'fcm',
      token,
      platform: `android/${Device.modelName ?? 'unknown'}`,
      ...(armedAt ? { armed_at: armedAt.toISOString() } : {}),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Could not register for push.' };
  }
}

function easProjectId(): string | null {
  return (
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
    Constants.easConfig?.projectId ??
    null
  );
}

/**
 * Every arming pass runs one at a time: each one cancels what we armed and
 * schedules afresh, so two overlapping passes could leave half of each.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * The native clock on its own: arm the week from the phone's copy of the
 * session, then (re)register for push stamped with the arming time. Used on
 * cold start and resume, before the web app has had a chance to send its list.
 */
export function syncClock(): Promise<void> {
  return serial(async () => {
    const armed = await armUpcoming();
    await registerForPush(armed !== null ? new Date() : undefined);
  });
}

/**
 * The reliable path: the web app fetched the reminder list with its own live
 * session (the same one every screen uses) and handed it over. No second
 * token, no second API address that could be stale or missing.
 */
export function syncFromWeb(occurrences: unknown[]): Promise<void> {
  return serial(async () => {
    const armed = await armOccurrences(occurrences, 'web');
    await registerForPush(armed !== null ? new Date() : undefined);
  });
}

/**
 * Sign-out cleanup, run *before* the native session is cleared so the push
 * withdrawal still carries a valid token. Cancels every reminder we armed and
 * dismisses ours from the shade — a signed-out phone must not keep showing the
 * account's reminders on its lock screen for the next 48 hours.
 */
export async function clearDeviceForSignOut(): Promise<void> {
  await cancelOwned().catch(() => undefined);
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  const token = pushToken;
  pushToken = null;
  if (token) await client.api.devices.unregister(token).catch(() => undefined);
}

/** What the web's Settings shows about notifications on this phone. */
export interface NotificationStatus {
  permission: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
  push: 'ready' | 'unconfigured' | 'unavailable';
  pushReason: string | null;
  armed: number;
  /** When the phone last received its reminder list, and what came of it. */
  lastArm: ArmResult | null;
}

export async function notificationStatus(): Promise<NotificationStatus> {
  const perm = await Notifications.getPermissionsAsync();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  const armed = scheduled.filter(
    (n) => (n.content.data as { owner?: string } | null)?.owner === OWNED,
  ).length;
  const projectId = easProjectId();
  return {
    permission: perm.granted ? 'granted' : perm.status === 'denied' ? 'denied' : 'undetermined',
    canAskAgain: perm.canAskAgain,
    push: pushToken ? 'ready' : projectId ? 'unavailable' : 'unconfigured',
    pushReason: pushToken
      ? null
      : projectId
        ? Device.isDevice
          ? 'Could not register for instant alerts yet.'
          : 'Push needs a real device.'
        : 'This build has no push configuration; scheduled reminders still work.',
    armed,
    lastArm,
  };
}

/** Ask again if Android still lets us; otherwise open the app's settings page. */
export async function requestPermissionOrOpenSettings(): Promise<void> {
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) {
    const asked = await Notifications.requestPermissionsAsync();
    if (asked.granted) return;
  }
  await Linking.openSettings().catch(() => undefined);
}
