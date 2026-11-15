import { Module } from '@nestjs/common';
import { PushService } from './push.service';

/**
 * Outbound notifications. The laptop owns this now: it is where the drain
 * loop lives (Phase 11) and therefore where anything with something to say
 * actually runs.
 */
@Module({
  providers: [PushService],
  exports: [PushService],
})
export class LocalNotificationsModule {}
