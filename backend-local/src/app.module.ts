import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module';
import { LlmModule } from './llm/llm.module';
import { AssistantModule } from './assistant/assistant.module';
import { SkillsModule } from './skills/skills.module';
import { PresenceModule } from './presence/presence.module';
import { LocalNotificationsModule } from './notifications/notifications.module';
import { LocalGmailModule } from './gmail/gmail.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { PulseModule } from './pulse/pulse.service';

/**
 * backend-local — the personal agent on your laptop.
 *
 * Assistant chat + LLM, direct Supabase access, heartbeat, and — since
 * Phase 11 — the drain loop that runs whatever fell due while it slept,
 * plus the email summaries of Phase 7.5. Everything else lives on
 * backend-render.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    CommonModule,
    LlmModule,
    SkillsModule,
    AssistantModule,
    PresenceModule,
    LocalNotificationsModule,
    LocalGmailModule,
    SchedulerModule,
    PulseModule,
  ],
})
export class AppModule {}
