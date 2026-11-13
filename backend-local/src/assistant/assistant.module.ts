import { Module } from '@nestjs/common';
import { SkillsModule } from '../skills/skills.module';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { InternalAiController } from './internal.controller';

@Module({
  imports: [SkillsModule],
  controllers: [AssistantController, InternalAiController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
