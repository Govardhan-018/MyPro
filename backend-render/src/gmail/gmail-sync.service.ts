import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { GmailApiService, GmailReauthRequired, type GmailMessage } from './gmail-api.service';

/** One page of a backfill. Gmail's own cap is 500; this is about politeness. */
const BACKFILL_PAGE = 50;
/** How far back a first connect reaches. A month is plenty to be useful. */
const BACKFILL_PAGES = 4;

interface AccountRow {
  id: string;
  user_id: string;
  email: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  history_id: string | null;
}

export interface SyncResult {
  account: string;
  fetched: number;
  stored: number;
  mode: 'backfill' | 'incremental';
  error?: string;
}

/**
 * Keeping `email_messages` current — Phase 7.4.
 *
 * Two modes, and which one runs is decided by whether we hold a usable
 * history cursor:
 *
 *  - **backfill** on a first connect, or whenever Gmail says our cursor is
 *    too old (it keeps roughly a week). Walks recent message ids and ends by
 *    recording the mailbox's current `historyId`.
 *  - **incremental** otherwise: ask Gmail what changed since the cursor. This
 *    is the cheap path and the one that runs essentially always.
 *
 * Request-driven on purpose. Render's free instance sleeps, so there is no
 * cron here to be killed (that was the whole lesson of Phase 11); the client
 * triggers a sync when it opens the mail view, and the laptop's drain loop
 * triggers one on its tick. Gmail watch → Pub/Sub push would be better still
 * and needs a Cloud project with a topic, which is out of scope while the
 * OAuth app is unverified.
 */
@Injectable()
export class GmailSyncService {
  private readonly logger = new Logger(GmailSyncService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly gmail: GmailApiService,
  ) {}

  /** Sync every mailbox a user has connected. */
  async syncUser(userId: string): Promise<SyncResult[]> {
    const { data, error } = await this.supabase.admin
      .from('gmail_accounts')
      .select(
        'id, user_id, email, access_token_enc, refresh_token_enc, token_expires_at, history_id',
      )
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`account lookup failed: ${error.message}`);
      return [];
    }

    const results: SyncResult[] = [];
    for (const account of (data ?? []) as AccountRow[]) {
      results.push(await this.syncAccount(account));
    }
    return results;
  }

  async syncAccount(account: AccountRow): Promise<SyncResult> {
    const mode = account.history_id ? 'incremental' : 'backfill';
    await this.mark(account.id, { sync_state: 'syncing', sync_error: null });

    try {
      const token = await this.gmail.accessTokenFor(account);
      const result =
        mode === 'incremental'
          ? await this.incremental(account, token)
          : await this.backfill(account, token);

      await this.mark(account.id, { sync_state: 'idle', sync_error: null });
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // A mailbox that needs re-consent is a state the UI must be able to
      // show, not a log line. `sync_error` is what the Settings panel reads.
      await this.mark(account.id, { sync_state: 'error', sync_error: reason });
      this.logger.warn(`sync failed for ${account.email}: ${reason}`);
      return {
        account: account.email,
        fetched: 0,
        stored: 0,
        mode,
        error:
          err instanceof GmailReauthRequired
            ? 'This mailbox needs reconnecting.'
            : 'Sync failed — try again.',
      };
    }
  }

  private async backfill(account: AccountRow, token: string): Promise<SyncResult> {
    let pageToken: string | undefined;
    let fetched = 0;
    let stored = 0;

    for (let page = 0; page < BACKFILL_PAGES; page++) {
      const { ids, nextPageToken } = await this.gmail.listMessageIds(token, {
        pageToken,
        max: BACKFILL_PAGE,
      });
      if (!ids.length) break;

      const written = await this.storeMessages(account, token, ids);
      fetched += ids.length;
      stored += written;

      if (!nextPageToken) break;
      pageToken = nextPageToken;
    }

    // Recorded last, and only on success: a cursor saved before the messages
    // it covers would make the incremental path skip them forever.
    const historyId = await this.gmail.currentHistoryId(token);
    if (historyId) await this.mark(account.id, { history_id: historyId });

    return { account: account.email, fetched, stored, mode: 'backfill' };
  }

  private async incremental(account: AccountRow, token: string): Promise<SyncResult> {
    const { ids, historyId, expired } = await this.gmail.historySince(
      token,
      account.history_id as string,
    );

    if (expired) {
      this.logger.log(`history cursor for ${account.email} expired — backfilling instead`);
      await this.mark(account.id, { history_id: null });
      return this.backfill({ ...account, history_id: null }, token);
    }

    const stored = ids.length ? await this.storeMessages(account, token, ids) : 0;
    if (historyId) await this.mark(account.id, { history_id: historyId });

    return { account: account.email, fetched: ids.length, stored, mode: 'incremental' };
  }

  /**
   * Fetch and upsert. `unique (gmail_account_id, gmail_message_id)` makes the
   * upsert idempotent, which matters because both the client and the laptop
   * may trigger a sync at the same moment.
   */
  private async storeMessages(
    account: AccountRow,
    token: string,
    ids: string[],
  ): Promise<number> {
    const messages = (
      await Promise.all(ids.map((id) => this.gmail.getMessage(token, id)))
    ).filter((m): m is GmailMessage => m !== null);

    if (!messages.length) return 0;

    const rows = messages.map((message) => ({
      user_id: account.user_id,
      gmail_account_id: account.id,
      gmail_message_id: message.id,
      gmail_thread_id: message.threadId,
      from_addr: message.headers.from,
      to_addrs: message.headers.to,
      subject: message.headers.subject,
      snippet: message.snippet,
      internal_date: message.internalDate?.toISOString() ?? null,
      is_read: !message.labelIds.includes('UNREAD'),
      is_important: message.labelIds.includes('IMPORTANT'),
    }));

    const { error } = await this.supabase.admin
      .from('email_messages')
      .upsert(rows, { onConflict: 'gmail_account_id,gmail_message_id' });

    if (error) {
      this.logger.error(`could not store messages for ${account.email}: ${error.message}`);
      return 0;
    }
    return rows.length;
  }

  private async mark(accountId: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase.admin
      .from('gmail_accounts')
      .update(patch)
      .eq('id', accountId);
    if (error) this.logger.warn(`could not update account ${accountId}: ${error.message}`);
  }
}
