import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, Post, Query,
  Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { SupabaseService } from '../common/supabase.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../common/audit.service';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { InternalAuthGuard } from '../common/internal-auth.guard';
import { many, none } from '../common/crud';
import { env } from '../config/env';
import { GoogleOAuthService } from './google-oauth.service';
import { GmailApiService, GmailReauthRequired } from './gmail-api.service';
import { GmailSyncService } from './gmail-sync.service';

const sendInput = z.object({
  user_id: z.string().uuid(),
  to: z.string().email(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(100_000),
  /** Which mailbox to send from; the first connected one by default. */
  account_id: z.string().uuid().optional(),
});

/**
 * Gmail — Phase 7.
 *
 * Render owns this entirely, for one reason: it is the only half that holds
 * `TOKEN_ENCRYPTION_KEY`, so it is the only half that can decrypt a mailbox
 * token. The laptop reaches `POST /internal/gmail/send` when the user
 * approves an outward action rather than holding a copy of the key.
 */
@Injectable()
export class GmailService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly crypto: CryptoService,
    private readonly oauth: GoogleOAuthService,
    private readonly api: GmailApiService,
    private readonly sync: GmailSyncService,
    private readonly audit: AuditService,
  ) {}

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

  /** Whether the server can run a connect flow at all (Phase 7.1). */
  status() {
    return { configured: this.oauth.configured() };
  }

  /** Step one of connecting a mailbox: where to send the browser. */
  connectUrl(user: AuthUser) {
    if (!this.oauth.configured()) {
      throw new BadRequestException(
        'Google OAuth is not configured on the server. Set GOOGLE_CLIENT_ID, ' +
          'GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.',
      );
    }
    return { url: this.oauth.authUrl(user.id) };
  }

  /**
   * Step two: Google sends the browser back here with a code.
   *
   * There is no session on this request — it is a top-level redirect from
   * accounts.google.com — so the user is identified by the signed `state`
   * issued in step one, and nothing else.
   *
   * Multiple accounts come for free: the row is keyed
   * `unique (user_id, email)`, so connecting a second mailbox adds a row and
   * reconnecting the same one updates its tokens in place.
   */
  async handleCallback(code: string, state: string): Promise<{ email: string }> {
    const userId = this.oauth.verifyState(state);
    if (!userId) throw new BadRequestException('This connect link has expired. Try again.');

    const tokens = await this.oauth.exchangeCode(code);
    const email = await this.oauth.emailFor(tokens.accessToken);
    if (!email) throw new BadRequestException('Could not read the Google account address');

    const existing = await this.supabase.admin
      .from('gmail_accounts')
      .select('id, refresh_token_enc')
      .eq('user_id', userId)
      .eq('email', email)
      .maybeSingle();

    const row = {
      user_id: userId,
      email,
      access_token_enc: this.crypto.encrypt(tokens.accessToken),
      token_expires_at: tokens.expiresAt.toISOString(),
      scopes: tokens.scopes,
      sync_state: 'idle',
      sync_error: null,
      /**
       * Only overwrite the refresh token when Google actually issued one.
       * On a re-consent it sometimes omits it, and writing null there would
       * turn a working mailbox into one that dies at the next expiry.
       */
      ...(tokens.refreshToken
        ? { refresh_token_enc: this.crypto.encrypt(tokens.refreshToken) }
        : {}),
    };

    const { error } = await this.supabase.admin
      .from('gmail_accounts')
      .upsert(row, { onConflict: 'user_id,email' });
    if (error) throw new BadRequestException(error.message);

    await this.audit.record({
      userId,
      actor: 'user',
      action: 'gmail.connect',
      targetType: 'gmail_account',
      detail: { email, reconnect: Boolean(existing.data) },
    });

    return { email };
  }

  async removeAccount(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    const result = none(await db.from('gmail_accounts').delete().eq('id', id));
    await this.audit.record({
      userId: user.id,
      actor: 'user',
      action: 'gmail.disconnect',
      targetType: 'gmail_account',
      targetId: id,
    });
    return result;
  }

  async syncNow(user: AuthUser) {
    return { results: await this.sync.syncUser(user.id) };
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

  /**
   * Really send — Phase 7.6.
   *
   * Called only by the laptop, and only once the user has approved the
   * pending action. The approval itself is recorded there; this records the
   * send, because an outward action with no trail is a liability.
   */
  async sendOnBehalf(input: z.infer<typeof sendInput>) {
    const query = this.supabase.admin
      .from('gmail_accounts')
      .select(
        'id, user_id, email, access_token_enc, refresh_token_enc, token_expires_at, history_id',
      )
      .eq('user_id', input.user_id);

    const { data, error } = input.account_id
      ? await query.eq('id', input.account_id).maybeSingle()
      : await query.order('created_at').limit(1).maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) {
      throw new BadRequestException('No Gmail account is connected — connect one in Settings.');
    }

    const account = data as Parameters<GmailApiService['accessTokenFor']>[0] & { email: string };

    try {
      const token = await this.api.accessTokenFor(account);
      const sent = await this.api.send(token, {
        to: input.to,
        subject: input.subject,
        body: input.body,
        from: account.email,
      });

      await this.audit.record({
        userId: input.user_id,
        actor: 'assistant',
        action: 'email.send',
        targetType: 'email_message',
        targetId: sent.id,
        detail: { to: input.to, subject: input.subject, from: account.email },
      });

      return { ok: true as const, id: sent.id, from: account.email };
    } catch (err) {
      if (err instanceof GmailReauthRequired) {
        throw new BadRequestException(
          'That mailbox needs reconnecting before MyPro can send from it.',
        );
      }
      throw err;
    }
  }
}

@Controller('gmail')
export class GmailController {
  constructor(private readonly gmail: GmailService) {}

  /**
   * Google's redirect lands here. **No AuthGuard**: this request comes from
   * accounts.google.com as a top-level navigation and carries no bearer
   * token. The signed `state` is the authentication.
   *
   * Declared before the guarded routes so the guard never sees it.
   */
  @Get('callback')
  async callback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const appUrl = env().APP_URL ?? env().CORS_ORIGINS[0] ?? '/';
    const back = (params: string) => res.redirect(`${appUrl.replace(/\/$/, '')}/?${params}`);

    if (error) return back(`gmail=denied`);
    if (!code || !state) return back(`gmail=error`);

    try {
      const { email } = await this.gmail.handleCallback(code, state);
      // The address goes in the fragment-free query only as a confirmation
      // the UI can show; it is the user's own address.
      return back(`gmail=connected&email=${encodeURIComponent(email)}`);
    } catch {
      return back(`gmail=error`);
    }
  }

  @Get('status')
  @UseGuards(AuthGuard)
  status() {
    return this.gmail.status();
  }

  @Get('accounts')
  @UseGuards(AuthGuard)
  accounts(@CurrentUser() user: AuthUser) {
    return this.gmail.accounts(user);
  }

  @Post('connect')
  @UseGuards(AuthGuard)
  connect(@CurrentUser() user: AuthUser) {
    return this.gmail.connectUrl(user);
  }

  @Delete('accounts/:id')
  @UseGuards(AuthGuard)
  removeAccount(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.gmail.removeAccount(user, id);
  }

  @Post('sync')
  @UseGuards(AuthGuard)
  sync(@CurrentUser() user: AuthUser) {
    return this.gmail.syncNow(user);
  }

  @Get('messages')
  @UseGuards(AuthGuard)
  messages(
    @CurrentUser() user: AuthUser,
    @Query('accountId') accountId?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Number.parseInt(limit, 10) : 50;
    return this.gmail.messages(user, accountId, Number.isFinite(n) ? n : 50);
  }
}

/**
 * node→node. The laptop calls this when the user approves a `send_email`
 * action, because the Gmail tokens and the key that decrypts them live only
 * here. Guarded by the shared secret, never reachable from a browser.
 */
@Controller('internal/gmail')
@UseGuards(InternalAuthGuard)
export class GmailInternalController {
  constructor(private readonly gmail: GmailService) {}

  @Post('send')
  send(@Body() body: unknown) {
    return this.gmail.sendOnBehalf(sendInput.parse(body));
  }
}

@Module({
  controllers: [GmailController, GmailInternalController],
  providers: [
    GmailService,
    GmailSyncService,
    GmailApiService,
    GoogleOAuthService,
    CryptoService,
    InternalAuthGuard,
  ],
})
export class GmailModule {}
