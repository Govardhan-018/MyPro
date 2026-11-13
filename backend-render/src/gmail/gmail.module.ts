import {
  Controller, Delete, Get, Injectable, Module, Param, Query, UseGuards,
} from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { many, none } from '../common/crud';

/**
 * Read-only for now. OAuth connect + incremental sync land in the Gmail
 * phase; these routes already serve whatever the sync worker has stored,
 * so the frontend can be built against them today.
 */
@Injectable()
export class GmailService {
  constructor(private readonly supabase: SupabaseService) {}

  async accounts(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    // Never expose token columns.
    return many(
      await db
        .from('gmail_accounts')
        .select('id, email, sync_state, sync_error, history_id, created_at')
        .order('created_at'),
    );
  }

  async removeAccount(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return none(await db.from('gmail_accounts').delete().eq('id', id));
  }

  async messages(user: AuthUser, accountId?: string, limit = 50) {
    const db = this.supabase.forUser(user.token);
    let q = db
      .from('email_messages')
      .select('*, email_insights(summary, category, action_needed, due_hint)')
      .order('internal_date', { ascending: false })
      .limit(Math.min(limit, 200));
    if (accountId) q = q.eq('gmail_account_id', accountId);
    return many(await q);
  }
}

@Controller('gmail')
@UseGuards(AuthGuard)
export class GmailController {
  constructor(private readonly gmail: GmailService) {}

  @Get('accounts')
  accounts(@CurrentUser() user: AuthUser) {
    return this.gmail.accounts(user);
  }

  @Delete('accounts/:id')
  removeAccount(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.gmail.removeAccount(user, id);
  }

  @Get('messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Query('accountId') accountId?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Number.parseInt(limit, 10) : 50;
    return this.gmail.messages(user, accountId, Number.isFinite(n) ? n : 50);
  }
}

@Module({ controllers: [GmailController], providers: [GmailService] })
export class GmailModule {}
