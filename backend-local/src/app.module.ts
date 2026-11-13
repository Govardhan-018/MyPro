import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module';
import { LlmModule } from './llm/llm.module';
import { AssistantModule } from './assistant/assistant.module';
import { SkillsModule } from './skills/skills.module';
import { PresenceModule } from './presence/presence.module';

/**
 * backend-local — the personal agent on your laptop.
 * Assistant chat + LLM, direct Supabase access, heartbeat.
 * Everything else lives on backend-render.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    CommonModule,
    LlmModule,
    SkillsModule,
    AssistantModule,
    PresenceModule,
  ],
})
export class AppModule {}
