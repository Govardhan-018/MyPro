import { Injectable, Logger } from '@nestjs/common';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { SupabaseService } from '../common/supabase.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../common/auth.guard';
import { SKILLS } from './definitions';
import type { InvocationReceipt, Skill, SkillContext } from './types';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ExecutionOutcome {
  /** What goes back to the model as the tool result. */
  content: string;
  isError: boolean;
  receipt: InvocationReceipt;
}

/**
 * Loosely typed on purpose: each skill carries its own argument generic, and
 * letting zod-to-json-schema infer through that makes the compiler recurse
 * without bound.
 */
const toJsonSchema = zodToJsonSchema as unknown as (
  schema: unknown,
  options?: unknown,
) => Record<string, unknown>;

/** Derived once at load — the registry is static. */
const TOOL_SCHEMAS: ReadonlyMap<string, Record<string, unknown>> = new Map(
  SKILLS.map((s) => [
    s.name,
    toJsonSchema(s.schema, { target: 'openApi3', $refStrategy: 'none' }),
  ]),
);

@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);
  private readonly byName = new Map<string, Skill<any>>(SKILLS.map((s) => [s.name, s]));

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The tools this user may use *right now*. Health skills simply do not
   * appear unless a live grant exists, so the model cannot be tempted into
   * asking for something it is not allowed to have.
   */
  async toolsFor(user: AuthUser): Promise<ToolDefinition[]> {
    const healthOk = await this.hasHealthGrant(user.id);
    return SKILLS.filter((s) => !s.requiresGrant || (s.requiresGrant === 'health' && healthOk)).map(
      (s) => ({
        name: s.name,
        description: s.description,
        input_schema: TOOL_SCHEMAS.get(s.name) ?? { type: 'object', properties: {} },
      }),
    );
  }

  /**
   * Run one tool call. Never throws: a failure becomes an error result the
   * model can read and recover from, plus a receipt recording what happened.
   */
  async execute(
    user: AuthUser,
    name: string,
    rawArgs: unknown,
    context: { conversationId?: string; timezone: string },
  ): Promise<ExecutionOutcome> {
    const started = Date.now();
    const skill = this.byName.get(name);

    if (!skill) {
      return this.failure(user, name, 'read', {}, `Unknown skill "${name}"`, context, 0);
    }

    const parsed = skill.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
        .join('; ');
      return this.failure(
        user,
        name,
        skill.sideEffect,
        rawArgs as Record<string, unknown>,
        `Invalid arguments — ${detail}`,
        context,
        Date.now() - started,
      );
    }
    const args = parsed.data as Record<string, unknown>;

    // Grants are re-checked at call time, not just at tool-listing time.
    if (skill.requiresGrant === 'health' && !(await this.hasHealthGrant(user.id))) {
      const receipt = await this.record(user, skill, args, {
        status: 'denied',
        error: 'no active health grant',
        context,
        durationMs: Date.now() - started,
        summary: 'Health access is not granted',
      });
      return {
        content: 'Denied: the user has not granted health access. Ask them to enable it.',
        isError: true,
        receipt,
      };
    }

    // Outward actions never run on the model's say-so.
    if (skill.sideEffect === 'outward') {
      const summary = this.summarise(skill, args, null);
      const receipt = await this.record(user, skill, args, {
        status: 'needs_approval',
        context,
        durationMs: Date.now() - started,
        summary,
      });
      await this.supabase.admin.from('pending_actions').insert({
        user_id: user.id,
        invocation_id: receipt.id,
        skill: skill.name,
        args,
        summary,
      });
      return {
        content:
          `Queued for approval — NOT done yet. The user must approve "${summary}" before it happens. ` +
          `Tell them plainly that it is waiting on them.`,
        isError: false,
        receipt,
      };
    }

    try {
      const ctx: SkillContext = {
        user,
        db: this.supabase.forUser(user.token),
        admin: this.supabase.admin,
        now: new Date(),
        timezone: context.timezone,
      };
      const result = await skill.run(parsed.data, ctx);
      const receipt = await this.record(user, skill, args, {
        status: 'success',
        result,
        context,
        durationMs: Date.now() - started,
        summary: this.summarise(skill, args, result),
      });
      return { content: JSON.stringify(result ?? { ok: true }), isError: false, receipt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`skill ${name} failed: ${message}`);
      return this.failure(
        user,
        name,
        skill.sideEffect,
        args,
        message,
        context,
        Date.now() - started,
      );
    }
  }

  // ---- helpers ----------------------------------------------------------

  private async hasHealthGrant(userId: string): Promise<boolean> {
    const { data } = await this.supabase.admin
      .from('health_access_grants')
      .select('id')
      .eq('user_id', userId)
      .eq('grantee', 'assistant')
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .limit(1);
    return Boolean(data?.length);
  }

  private async failure(
    user: AuthUser,
    name: string,
    sideEffect: Skill['sideEffect'],
    args: Record<string, unknown>,
    error: string,
    context: { conversationId?: string },
    durationMs: number,
  ): Promise<ExecutionOutcome> {
    const receipt = await this.record(
      user,
      { name, sideEffect } as Skill,
      args,
      { status: 'failed', error, context, durationMs, summary: `${name} failed` },
    );
    return { content: `Error: ${error}`, isError: true, receipt };
  }

  private async record(
    user: AuthUser,
    skill: Pick<Skill, 'name' | 'sideEffect'>,
    args: Record<string, unknown>,
    opts: {
      status: InvocationReceipt['status'];
      result?: unknown;
      error?: string;
      summary: string;
      durationMs: number;
      context: { conversationId?: string };
    },
  ): Promise<InvocationReceipt> {
    const row = {
      user_id: user.id,
      conversation_id: opts.context.conversationId ?? null,
      skill: skill.name,
      side_effect: skill.sideEffect,
      args,
      result: opts.result === undefined ? null : (opts.result as Record<string, unknown>),
      status: opts.status,
      error: opts.error ?? null,
      duration_ms: opts.durationMs,
    };

    const { data, error } = await this.supabase.admin
      .from('skill_invocations')
      .insert(row)
      .select('id')
      .single();

    if (error) this.logger.error(`receipt write failed: ${error.message}`);

    // Anything that changes state or reaches outward is worth auditing.
    if (skill.sideEffect !== 'read') {
      await this.audit.record({
        userId: user.id,
        actor: 'assistant',
        action: `skill.${skill.name}`,
        detail: { status: opts.status, side_effect: skill.sideEffect },
      });
    }

    return {
      id: (data as { id: string } | null)?.id ?? 'unrecorded',
      skill: skill.name,
      side_effect: skill.sideEffect,
      args,
      status: opts.status,
      summary: opts.summary,
      error: opts.error,
    };
  }

  /** Short human sentence for the receipt card in the chat. */
  private summarise(skill: Pick<Skill, 'name'>, args: Record<string, unknown>, result: unknown): string {
    const pick = (o: unknown, k: string): string | undefined => {
      const v = (o as Record<string, unknown> | null)?.[k];
      return typeof v === 'string' ? v : undefined;
    };
    const title = pick(result, 'title') ?? pick(args, 'title') ?? pick(args, 'name');

    switch (skill.name) {
      case 'create_event':
        return `Scheduled "${title ?? 'event'}"`;
      case 'update_event':
        return `Updated "${title ?? 'event'}"`;
      case 'delete_event':
        return 'Deleted an event';
      case 'create_task':
        return `Added task "${title ?? ''}"`.trim();
      case 'update_task':
        return pick(args, 'status') === 'done'
          ? `Completed "${title ?? 'task'}"`
          : `Updated task "${title ?? ''}"`.trim();
      case 'add_library_item':
        return `Added "${title ?? 'item'}" to the library`;
      case 'update_reading_progress':
        return `Updated progress on "${title ?? 'item'}"`;
      case 'save_note':
        return 'Saved a note';
      case 'send_notification':
        return `Notified: "${title ?? ''}"`.trim();
      case 'create_schedule':
        return `Created schedule "${title ?? ''}"`.trim();
      case 'delete_schedule':
        return 'Removed a schedule';
      case 'send_email':
        return `Send email to ${pick(args, 'to') ?? 'recipient'} — "${pick(args, 'subject') ?? ''}"`;
      default:
        return skill.name.replace(/_/g, ' ');
    }
  }
}
