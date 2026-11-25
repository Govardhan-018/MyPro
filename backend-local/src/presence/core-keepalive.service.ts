import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { env, renderApiBase } from '../config/env';

/**
 * The agent keeps the core awake.
 *
 * Supabase Cron wakes this service; this service wakes the other one. That
 * chain is what lets both Render instances stay resident without a second
 * external scheduler: Supabase only ever has to know about one URL, and the
 * node that is already awake every ten minutes is the obvious thing to do
 * the next hop.
 *
 * Why two services at all, rather than one merged deployable: a free Render
 * instance is 512MB and a fraction of a CPU, and that is *per service*. Two
 * of them is twice the memory and twice the CPU, with the model work and the
 * CRUD work unable to starve each other. The cost is instance hours, which
 * are pooled — so check the budget before assuming both can stay up around
 * the clock (`docs/DEPLOY_AGENT_TO_RENDER.md`).
 *
 * Runs only on the node that owns the clock (`SCHEDULER_ENABLED`), so a
 * laptop started for local development does not also start pinging
 * production every ten minutes.
 *
 * Every failure is swallowed and logged. A core that cannot be reached is
 * worth a line in the log; it is not worth taking the agent down for, and
 * the core will wake on the next real request anyway.
 */
@Injectable()
export class CoreKeepAliveService {
  private readonly logger = new Logger(CoreKeepAliveService.name);
  private consecutiveFailures = 0;

  /** Ten minutes: comfortably inside Render's ~15-minute idle window. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async ping(): Promise<void> {
    const base = renderApiBase();
    if (!base || !env().SCHEDULER_ENABLED) return;

    try {
      const res = await fetch(`${base}/internal/keepalive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': env().INTERNAL_SERVICE_TOKEN,
        },
        body: JSON.stringify({ source: 'agent-keepalive' }),
        // A sleeping instance takes ~30s to wake, and waking it is the point.
        signal: AbortSignal.timeout(45_000),
      });

      if (!res.ok) {
        this.note(`core answered ${res.status}`);
        return;
      }
      if (this.consecutiveFailures) {
        this.logger.log(`core reachable again after ${this.consecutiveFailures} failed pings`);
      }
      this.consecutiveFailures = 0;
    } catch (err) {
      this.note(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Log the first failure and then only every sixth (hourly), so a core
   * that has been down all week does not drown the log it would be found in.
   */
  private note(reason: string): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures === 1 || this.consecutiveFailures % 6 === 0) {
      this.logger.warn(
        `core keep-alive failed (${this.consecutiveFailures}x): ${reason.slice(0, 200)}`,
      );
    }
  }
}
