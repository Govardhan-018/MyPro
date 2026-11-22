import { Module } from '@nestjs/common';
import { SkillsModule } from '../skills/skills.module';
import { CapabilityRegistry } from './capability.registry';

@Module({
  imports: [SkillsModule],
  providers: [CapabilityRegistry],
  exports: [CapabilityRegistry],
})
export class CapabilitiesModule {}
