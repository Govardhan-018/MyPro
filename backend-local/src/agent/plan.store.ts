import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import type { AuthUser } from '../common/auth.guard';
import type { AgentPlan, StepOutcome } from './plan.types';
import type { EffortMode } from './effort';

/**
 * Plan persistence — so a multi-step turn is inspectable after the fact.
 *
 * This is the record that answers "what did it set out to do, and what did it
 * actually manage?" long after the chat has scrolled. Writes go through the
 * **user's** RLS-scoped client: a plan is their data, not system telemetry.
 *
 * Every method swallows its own failures. A plan that cannot be recorded must
 * never cost the user their answer.
 */
@Injectable()
export class PlanStore {
  private readonly logger = new Logger(PlanStore.name);

  constructor(private readonly supabase: SupabaseService) {}

  async open(params: {
    user: AuthUser;
    conversationId: string;
    request: string;
    plan: AgentPlan;
    mode: EffortMode;
    routing: { capabilities: string[]; ambiguous: boolean; viaModel: boolean };
  }): Promise<string | null> {
    try {
      const db = this.supabase.forUser(params.user.token);
      const { data, error } = await db
        .from('agent_plans')
        .insert({
          user_id: params.user.id,
          conversation_id: params.conversationId,
          request: params.request.slice(0, 4_000),
          intent: params.plan.intent,
          mode: params.mode,
          status: 'running',
          step_count: params.plan.steps.length,
          routing: params.routing,
        })
        .select('id')
        .single();

      if (error) throw new Error(error.message);
      const planId = (data as { id: string }).id;

      const rows = params.plan.steps.map((step, index) => ({
        plan_id: planId,
        user_id: params.user.id,
        ordinal: index,
        step_key: step.id,
        goal: step.goal,
        capability: step.capability,
        depends_on: step.depends_on,
        status: 'pending',
      }));
      const stepWrite = await db.from('agent_plan_steps').insert(rows);
      if (stepWrite.error) throw new Error(stepWrite.error.message);

      return planId;
    } catch (err) {
      this.logger.warn(`plan not recorded: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async close(params: {
    user: AuthUser;
    planId: string;
    outcomes: readonly StepOutcome[];
    status: 'completed' | 'partial' | 'failed';
  }): Promise<void> {
    try {
      const db = this.supabase.forUser(params.user.token);
      const finished = new Date().toISOString();

      for (const outcome of params.outcomes) {
        await db
          .from('agent_plan_steps')
          .update({
            status: outcome.status,
            invocation_id: outcome.invocationId ?? null,
            detail: outcome.detail?.slice(0, 1_000) ?? null,
            finished_at: finished,
          })
          .eq('plan_id', params.planId)
          .eq('step_key', outcome.step.id);
      }

      await db
        .from('agent_plans')
        .update({ status: params.status, completed_at: finished })
        .eq('id', params.planId);
    } catch (err) {
      this.logger.warn(`plan not closed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
