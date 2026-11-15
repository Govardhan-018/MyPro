import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { LocalNotificationsModule } from '../notifications/notifications.module';
import { SchedulerService } from './scheduler.service';

/**
 * The laptop owns the clock's *work* (Phase 11.1). Firing on time is the
 * phone's job (11.2) — this is what runs when the moment arrives, and what
 * drains whatever fell due while the machine was shut.
 */
@Module({
  imports: [LlmModule, LocalNotificationsModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
