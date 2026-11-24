import { Injectable, Logger } from '@nestjs/common';
import webpush, { type PushSubscription, type SendResult, WebPushError } from 'web-push';
import { SupabaseService } from '../common/supabase.service';
import { env } from '../config/env';

/** What the user actually sees, on whatever surface reaches them. */
export interface NotifyPayload {
  title: string;
  body?: string;
  /** In-app route the notification opens, e.g. '/assistant'. */
  deeplink?: string;
  /** brief | nudge | reminder | email_alert | schedule */
  kind?: string;
  scheduleId?: string;
  /**
   * For a "Remind me" the phone may already hold locally: the instant it was
   * due and when its schedule was last edited. An Android device that armed
   * its clock after that edit (and before the moment) already shows it, so it
   * is not pushed a second copy. Absent → push everywhere.
   */
  localCopy?: { dueAt: Date; scheduleUpdatedAt: Date };
}

interface DeviceRow {
  id: string;
  channel_type: 'web_push' | 'fcm' | 'telegram';
  token: string;
  armed_at?: string | null;
}

/** How far ahead the phone arms (`ARM_WINDOW_HOURS` in android/src/lib/notifications.ts). */
const PHONE_ARM_WINDOW_MS = 48 * 3600_000;

/**
 * Whether an Android device already holds this reminder as a local
 * notification. Pure, so the dedupe rule is unit-tested.
 */
export function deviceHoldsLocalCopy(
  armedAt: string | null | undefined,
  local: { dueAt: Date; scheduleUpdatedAt: Date },
): boolean {
  if (!armedAt) return false;
  const armed = new Date(armedAt).getTime();
  if (!Number.isFinite(armed)) return false;
  const due = local.dueAt.getTime();
  return (
    armed >= local.scheduleUpdatedAt.getTime() && // armed after the last edit
    armed < due && // ...before it fired
    due - armed <= PHONE_ARM_WINDOW_MS // ...and it was inside the armed window
  );
}

/** Expo's push gateway — no key, no project credentials, no cost. */
const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[.+\]$/;
const PUSH_TIMEOUT_MS = 10_000;

/**
 * The Android channel a push should land on, mirroring the local clock's
 * channels (`android/src/lib/notifications.ts`) so the user tunes one set of
 * categories whether a notification was armed locally or pushed. A brief is its
 * own channel; everything else is a reminder.
 */
function channelForKind(kind?: string): 'reminders' | 'briefs' {
  return kind && kind.startsWith('brief') ? 'briefs' : 'reminders';
}

/**
 * One way out of the system, used by everything that has something to say.
 *
 * It writes the `notifications` row first — that row is the durable record and
 * the thing Supabase Realtime carries to any open app — and only then tries to
 * reach closed apps through whatever `device_tokens` holds. A push that fails
 * never fails the caller: the notification still exists and still arrives the
 * moment the app is opened.
 *
 * This is Phase 6.4 / 11.5: the `TODO(channels)` that used to sit in render's
 * scheduler, moved to the laptop along with the drain loop that calls it.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private vapidReady: boolean | null = null;
  /** Raw-FCM tokens need a service account we deliberately do not have. */
  private warnedAboutRawFcm = false;

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Record a notification and fan it out.
   * Returns the new row's id, or null if even the insert failed.
   */
  async send(userId: string, payload: NotifyPayload): Promise<string | null> {
    const { data, error } = await this.supabase.admin
      .from('notifications')
      .insert({
        user_id: userId,
        title: payload.title,
        body: payload.body ?? null,
        deeplink: payload.deeplink ?? null,
        kind: payload.kind ?? null,
        schedule_id: payload.scheduleId ?? null,
      })
      .select('id')
      .single();

    if (error) {
      this.logger.error(`could not record notification for ${userId}: ${error.message}`);
      return null;
    }

    const id = (data as { id: string }).id;
    // Fan-out is best-effort and must not hold up the caller's own work.
    const delivered = await this.fanOut(userId, id, payload);
    if (delivered > 0) {
      await this.supabase.admin
        .from('notifications')
        .update({ delivered_at: new Date().toISOString() })
        .eq('id', id);
    }
    return id;
  }

  /** @returns how many devices accepted the push. */
  private async fanOut(userId: string, notificationId: string, payload: NotifyPayload) {
    const local = payload.localCopy;
    const devices = (await this.devicesFor(userId)).filter(
      (d) => !(local && d.channel_type === 'fcm' && deviceHoldsLocalCopy(d.armed_at, local)),
    );
    if (!devices.length) return 0;

    const results = await Promise.all(
      devices.map((d) => this.sendToDevice(d, notificationId, payload)),
    );
    return results.filter(Boolean).length;
  }

  /**
   * Devices to try, filtered by the user's own channel preferences. A channel
   * with no `notification_channels` row is treated as enabled — the table
   * records a decision, and its absence is not a decision to stay silent.
   */
  private async devicesFor(userId: string): Promise<DeviceRow[]> {
    const db = this.supabase.admin;
    const [firstDevices, channelsRes] = await Promise.all([
      db.from('device_tokens').select('id, channel_type, token, armed_at').eq('user_id', userId),
      db.from('notification_channels').select('type, enabled').eq('user_id', userId),
    ]);
    // Before migration 0022 there is no armed_at; push everywhere instead.
    const devicesRes =
      firstDevices.error && /armed_at/.test(firstDevices.error.message)
        ? await db.from('device_tokens').select('id, channel_type, token').eq('user_id', userId)
        : firstDevices;

    if (devicesRes.error) {
      this.logger.warn(`device lookup failed: ${devicesRes.error.message}`);
      return [];
    }

    const disabled = new Set(
      ((channelsRes.data ?? []) as { type: string; enabled: boolean }[])
        .filter((c) => !c.enabled)
        .map((c) => c.type),
    );

    return ((devicesRes.data ?? []) as DeviceRow[]).filter(
      (d) => d.channel_type !== 'telegram' && !disabled.has(d.channel_type),
    );
  }

  private async sendToDevice(
    device: DeviceRow,
    notificationId: string,
    payload: NotifyPayload,
  ): Promise<boolean> {
    try {
      if (device.channel_type === 'web_push') {
        return await this.sendWebPush(device, notificationId, payload);
      }
      if (device.channel_type === 'fcm') {
        return await this.sendExpoPush(device, notificationId, payload);
      }
      return false;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`push to ${device.channel_type} device ${device.id} failed: ${reason}`);
      return false;
    }
  }

  // ---- web push (VAPID) -------------------------------------------------

  /** VAPID keys are optional: without them web push is simply off. */
  private vapidConfigured(): boolean {
    if (this.vapidReady !== null) return this.vapidReady;
    const { WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, WEB_PUSH_SUBJECT } = env();
    if (!WEB_PUSH_PUBLIC_KEY || !WEB_PUSH_PRIVATE_KEY) {
      this.logger.log('web push is not configured (no VAPID keys) — skipping that channel');
      this.vapidReady = false;
      return false;
    }
    webpush.setVapidDetails(
      WEB_PUSH_SUBJECT || 'mailto:nobody@example.com',
      WEB_PUSH_PUBLIC_KEY,
      WEB_PUSH_PRIVATE_KEY,
    );
    this.vapidReady = true;
    return true;
  }

  private async sendWebPush(
    device: DeviceRow,
    notificationId: string,
    payload: NotifyPayload,
  ): Promise<boolean> {
    if (!this.vapidConfigured()) return false;

    let subscription: PushSubscription;
    try {
      subscription = JSON.parse(device.token) as PushSubscription;
    } catch {
      this.logger.warn(`device ${device.id} holds an unparseable subscription — dropping it`);
      await this.forget(device.id);
      return false;
    }

    try {
      const res: SendResult = await webpush.sendNotification(
        subscription,
        JSON.stringify({
          id: notificationId,
          title: payload.title,
          body: payload.body ?? '',
          deeplink: payload.deeplink ?? null,
          kind: payload.kind ?? null,
        }),
        { TTL: 60 * 60 * 24 },
      );
      return res.statusCode >= 200 && res.statusCode < 300;
    } catch (err) {
      // 404/410 mean the browser threw the subscription away; so should we,
      // or it is retried on every notification forever.
      if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
        this.logger.log(`subscription ${device.id} is gone (${err.statusCode}) — forgetting it`);
        await this.forget(device.id);
        return false;
      }
      throw err;
    }
  }

  // ---- Android, via Expo's push gateway ---------------------------------

  /**
   * `channel_type = 'fcm'` rows hold an **Expo** push token. Expo's gateway
   * delivers through FCM for us and needs no server key, which keeps the
   * zero-cost rule. A bare FCM registration token cannot be used: FCM's v1 API
   * requires a signed service-account JWT, and that is a credential this
   * project has chosen not to carry.
   */
  private async sendExpoPush(
    device: DeviceRow,
    notificationId: string,
    payload: NotifyPayload,
  ): Promise<boolean> {
    if (!EXPO_TOKEN_RE.test(device.token)) {
      if (!this.warnedAboutRawFcm) {
        this.logger.warn(
          'a device registered a raw FCM token; MyPro pushes through Expo and cannot use it',
        );
        this.warnedAboutRawFcm = true;
      }
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          to: device.token,
          title: payload.title,
          body: payload.body ?? '',
          sound: 'default',
          // FCM "high" priority: delivered immediately even in Doze and shown
          // as a heads-up. Without it Android batches the message until the
          // next maintenance window — the "notification arrived 20 minutes
          // late" bug.
          priority: 'high',
          // A reminder that cannot be delivered within a day is stale.
          ttl: 60 * 60 * 24,
          channelId: channelForKind(payload.kind),
          data: {
            id: notificationId,
            deeplink: payload.deeplink ?? null,
            kind: payload.kind ?? null,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn(`expo push responded ${res.status}`);
        return false;
      }

      const body = (await res.json()) as {
        data?: { status?: string; details?: { error?: string } };
      };
      const status = body.data?.status;
      if (status === 'ok') return true;

      // Expo tells us explicitly when a token belongs to an app that is gone.
      if (body.data?.details?.error === 'DeviceNotRegistered') {
        this.logger.log(`expo token ${device.id} is no longer registered — forgetting it`);
        await this.forget(device.id);
      } else {
        this.logger.warn(`expo push rejected: ${body.data?.details?.error ?? status ?? 'unknown'}`);
      }
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- housekeeping -----------------------------------------------------

  private async forget(deviceId: string): Promise<void> {
    const { error } = await this.supabase.admin.from('device_tokens').delete().eq('id', deviceId);
    if (error) this.logger.warn(`could not delete device ${deviceId}: ${error.message}`);
  }
}
