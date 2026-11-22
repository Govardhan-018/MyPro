import { Module } from '@nestjs/common';
import { SkillsModule } from '../skills/skills.module';
import { AgentModule } from '../agent/agent.module';
import { CapabilitiesModule } from '../capabilities/capabilities.module';
import { ResearchModule } from '../research/research.module';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { InternalAiController } from './internal.controller';

@Module({
  imports: [SkillsModule, AgentModule, CapabilitiesModule, ResearchModule],
  controllers: [AssistantController, InternalAiController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
