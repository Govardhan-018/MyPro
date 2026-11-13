import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

export interface AuditEntry {
  userId: string | null;
  actor: 'user' | 'assistant' | 'system';
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  detail?: Record<string, unknown>;
}

/**
 * Append-only trail of anything security-relevant: health reads, schedule
 * executions, outward sends. Writes use the service role because the user
 * must not be able to edit or erase their own audit history.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async record(entry: AuditEntry): Promise<void> {
    const { error } = await this.supabase.admin.from('audit_log').insert({
      user_id: entry.userId,
      actor: entry.actor,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ?? null,
      detail: entry.detail ?? null,
    });
    // Auditing must never break the request it is auditing.
    if (error) this.logger.error(`audit write failed: ${error.message}`);
  }
}
