import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { hostname } from 'node:os';
import { SupabaseService } from '../common/supabase.service';
import { env } from '../config/env';

/**
 * Announces this laptop every 30 seconds. render and the UI treat the
 * agent as offline once the heartbeat is ~90s stale, so simply closing
 * the laptop flips the system into degraded mode with no cleanup needed.
 */
@Injectable()
export class PresenceService implements OnModuleInit {
  private readonly logger = new Logger(PresenceService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Announce immediately on boot, then on the cron. */
  async onModuleInit(): Promise<void> {
    await this.announce();
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async announce(): Promise<void> {
    const { error } = await this.supabase.admin.from('node_status').upsert(
      {
        node: 'local',
        base_url: env().PUBLIC_BASE_URL ?? null,
        last_heartbeat_at: new Date().toISOString(),
        detail: { host: hostname() },
      },
      { onConflict: 'node' },
    );
    if (error) this.logger.warn(`heartbeat failed: ${error.message}`);
  }
}

@Module({ providers: [PresenceService] })
export class PresenceModule {}
