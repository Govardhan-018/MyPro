import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { LlmModule } from '../llm/llm.module';
import { SkillsModule } from '../skills/skills.module';
import { CapabilitiesModule } from '../capabilities/capabilities.module';
import { AgentCoreService } from './agent-core.service';
import { IntentRouterService } from './intent-router.service';
import { PlannerService } from './planner.service';
import { ExecutionService } from './execution.service';
import { PlanStore } from './plan.store';

/**
 * The agent core: routing, planning, execution, verification.
 *
 * Holds no capabilities of its own — it orchestrates `SkillsModule` through
 * `CapabilitiesModule`, so there is still exactly one definition of each skill.
 */
@Module({
  imports: [CommonModule, LlmModule, SkillsModule, CapabilitiesModule],
  providers: [AgentCoreService, IntentRouterService, PlannerService, ExecutionService, PlanStore],
  exports: [AgentCoreService],
})
export class AgentModule {}
