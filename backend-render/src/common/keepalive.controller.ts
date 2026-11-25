import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { InternalAuthGuard } from './internal-auth.guard';
import { env } from '../config/env';
import { selfApiUrl } from '../nodes/node-status.service';

/**
 * Keep-alive — the thing that stops Render's free instance falling asleep.
 *
 * Render free web services sleep after ~15 minutes with no inbound request,
 * and waking costs ~30 seconds on the next screen. Supabase Cron calls this
 * every 10 minutes through `pg_net`, which is enough to keep the process
 * resident without a paid plan. See `supabase/migrations/0015_keepalive.sql`
 * for the scheduler half.
 *
 * **This is not the scheduler.** It deliberately does no AI work, runs no
 * jobs and touches no user data — mistaking a keep-alive ping for a tick is
 * how you end up with two schedulers racing. All it does is answer, and
 * record that it answered.
 *
 * It is guarded by the shared secret rather than left open: an unauthenticated
 * endpoint that writes a row is a free way for a stranger to fill a table.
 */
@Controller('internal/keepalive')
export class KeepAliveController {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * The ping. POST because it writes; the cron uses this one.
   *
   * The write goes to `node_status` under `node = 'render'`, the same table
   * the laptop heartbeats into — so "is the core awake?" becomes answerable
   * in the UI for free, and there is one presence table rather than two.
   */
  @Post()
  @UseGuards(InternalAuthGuard)
  async ping() {
    const now = new Date().toISOString();

    const { error } = await this.supabase.admin.from('node_status').upsert(
      {
        node: 'render',
        base_url: env().APP_URL ?? null,
        last_heartbeat_at: now,
        // The API's own root, so the agent finds the real host (not a
        // hand-set RENDER_API_URL that may name the wrong service).
        detail: {
          source: 'keepalive',
          node_env: env().NODE_ENV,
          api_url: selfApiUrl({
            PUBLIC_API_URL: (process.env.PUBLIC_API_URL ?? '').trim() || undefined,
            RENDER_EXTERNAL_URL: (process.env.RENDER_EXTERNAL_URL ?? '').trim() || undefined,
          }),
        },
      },
      { onConflict: 'node' },
    );

    // A failed write is worth reporting in the response — the cron records
    // the status code, so a broken database shows up as a failing ping
    // rather than as silence.
    return { status: error ? 'degraded' : 'ok', at: now, ...(error ? { detail: error.message } : {}) };
  }

  /**
   * Unauthenticated liveness, for Render's own health check and for a quick
   * "is it up?" from a browser. Writes nothing and reveals nothing.
   */
  @Get()
  alive() {
    return { status: 'ok' };
  }
}
