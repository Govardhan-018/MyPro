import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';

/**
 * Training history, from the laptop's side — Phase 20.5.
 *
 * The laptop never holds a Strava token. Render does, along with
 * `TOKEN_ENCRYPTION_KEY`, so this asks render for the activities rather than
 * carrying a second copy of the credential. Same shape, and the same
 * reasoning, as `gmail/render-mail.service.ts`.
 *
 * Every failure is returned, never thrown: this feeds a workout suggestion,
 * and "I could not see your training history" is a usable answer while a
 * stack trace is not.
 */

export interface StravaActivity {
  id: string;
  name: string;
  type: string;
  start_date: string;
  distance_km: number;
  moving_minutes: number;
  elevation_m: number;
  average_hr?: number;
  suffer_score?: number;
}

export type ActivitiesOutcome =
  | { ok: true; connected: boolean; activities: StravaActivity[] }
  | { ok: false; reason: string };

const REQUEST_TIMEOUT_MS = 20_000;

@Injectable()
export class StravaClientService {
  private readonly logger = new Logger(StravaClientService.name);

  configured(): boolean {
    return Boolean(env().RENDER_API_URL);
  }

  async activities(params: {
    userId: string;
    sinceDays: number;
    limit: number;
  }): Promise<ActivitiesOutcome> {
    const base = env().RENDER_API_URL;
    if (!base) {
      return {
        ok: false,
        reason:
          'Training history is not wired up on this machine — set RENDER_API_URL in backend-local/.env.',
      };
    }

    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/internal/strava/activities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': env().INTERNAL_SERVICE_TOKEN,
        },
        body: JSON.stringify({
          user_id: params.userId,
          since_days: params.sinceDays,
          limit: params.limit,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        this.logger.warn(`strava read failed (${res.status})`);
        return {
          ok: false,
          reason:
            res.status === 400 && detail.includes('reconnect')
              ? 'Strava needs reconnecting in settings.'
              : `Strava could not be read right now (${res.status}).`,
        };
      }

      const body = (await res.json()) as { connected?: boolean; activities?: StravaActivity[] };
      return { ok: true, connected: Boolean(body.connected), activities: body.activities ?? [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`strava read failed: ${message}`);
      return {
        ok: false,
        reason: /abort|timeout/i.test(message)
          ? 'Strava took too long to answer.'
          : 'Could not reach the service that holds your Strava connection.',
      };
    }
  }
}
