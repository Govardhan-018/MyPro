import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from './internal-auth.guard';
import { env } from '../config/env';

/**
 * Keep-alive — what stops this service falling asleep once it lives on
 * Render instead of a laptop.
 *
 * The agent is the half that *must* stay resident: it owns the drain loop,
 * the Pulse, the narrative and episode refreshes and the email summaries.
 * A sleeping core only costs a cold start on the next screen; a sleeping
 * agent means the 8am brief never arrives. So this is the endpoint Supabase
 * Cron pings every 10 minutes (`supabase/migrations/0016_keepalive_agent.sql`).
 *
 * **It is a ping, not a tick.** It runs no jobs, calls no model and writes
 * nothing — `PresenceService` already heartbeats `node_status` every 30s, so
 * there is nothing useful left for this to record. Keeping it free of side
 * effects is deliberate: the cheapest possible endpoint is the one least
 * likely to become a second, accidental scheduler.
 *
 * Guarded by the shared secret, because an unauthenticated endpoint on a
 * service whose whole job is to never sleep is an invitation.
 */
@Controller('internal/keepalive')
export class KeepAliveController {
  @Post()
  @UseGuards(InternalAuthGuard)
  ping() {
    return {
      status: 'ok',
      at: new Date().toISOString(),
      // Worth returning: if this is ever false on the always-on node, the
      // clock is not running and nothing scheduled will fire.
      scheduler: env().SCHEDULER_ENABLED,
    };
  }

  /** Unauthenticated liveness, for Render's own health check. */
  @Get()
  alive() {
    return { status: 'ok' };
  }
}
