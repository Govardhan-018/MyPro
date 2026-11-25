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
import { GoogleOAuthService, scopesGrantSend, type GmailAccessLevel } from './google-oauth.service';
import { GoogleCredsService } from './google-creds.service';
import { GmailApiService, GmailReauthRequired } from './gmail-api.service';
import { GmailSyncService } from './gmail-sync.service';

const connectInput = z.object({
  /** How much access to request for this mailbox. Defaults to read-only. */
  mode: z.enum(['read', 'send']).default('read'),
  /**
   * Where Google's redirect should finally land: the web app, or back into the
   * Android app (the consent screen runs in the system browser there, because
   * Google refuses OAuth inside a WebView).
   */
  return_to: z.enum(['web', 'app']).default('web'),
});

const oauthConfigInput = z.object({
  client_id: z.string().min(10).max(500),
  client_secret: z.string().min(10).max(500),
  /**
   * Legacy and optional: the server derives its own callback URL. Only used
   * when the server cannot work out its public address.
   */
  redirect_uri: z.string().url().max(500).optional(),
});

/** The app's own URL scheme (android/app.json `scheme`). */
const APP_RETURN_URL = 'mypro://gmail';

/**
 * A tiny page that hands the browser back to the Android app. A bare 302 to a
 * custom scheme is silently dropped by some browsers; a page with an automatic
 * redirect *and* a button always works. `params` is built by us from a fixed
 * set of keys plus a URL-encoded address, and is HTML-escaped regardless.
 */
export function appReturnPage(params: string): string {
  const target = `${APP_RETURN_URL}?${params}`;
  const safe = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${safe}"><title>Back to MyPro</title>
<style>body{background:#000;color:#fff;font:16px system-ui,sans-serif;display:flex;min-height:100vh;
align-items:center;justify-content:center;margin:0;padding:16px;text-align:center}
a{display:inline-block;margin-top:16px;padding:12px 22px;border:1px solid rgba(255,255,255,.4);
border-radius:999px;color:#fff;text-decoration:none}</style></head>
<body><div><p>Gmail sign-in finished.</p><a href="${safe}">Return to MyPro</a></div></body></html>`;
}

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
    private readonly creds: GoogleCredsService,
    private readonly api: GmailApiService,
    private readonly sync: GmailSyncService,
    private readonly audit: AuditService,
  ) {}

  /** Whether a connect flow can run, and where the credentials come from. */
  async oauthConfigStatus(user: AuthUser) {
    return this.creds.status(user.id);
  }

  /** Save the in-app Google OAuth app credentials (secret encrypted at rest). */
  async saveOauthConfig(user: AuthUser, input: z.infer<typeof oauthConfigInput>) {
    try {
      await this.creds.save(user.id, {
        clientId: input.client_id,
        clientSecret: input.client_secret,
        redirectUri: input.redirect_uri ?? null,
      });
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Could not save.');
    }
    await this.audit.record({
      userId: user.id,
      actor: 'user',
      action: 'gmail.oauth_config.save',
      targetType: 'google_oauth_config',
    });
    return this.creds.status(user.id);
  }

  /** Remove the in-app credentials; connect then falls back to env, if set. */
  async deleteOauthConfig(user: AuthUser) {
    await this.creds.remove(user.id);
    await this.audit.record({
      userId: user.id,
      actor: 'user',
      action: 'gmail.oauth_config.delete',
      targetType: 'google_oauth_config',
    });
    return this.creds.status(user.id);
  }

  async accounts(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    // Never expose token columns.
    return many(
      await db
        .from('gmail_accounts')
        .select('id, email, scopes, sync_state, sync_error, history_id, created_at')
        .order('created_at'),
    );
  }

  /** Whether the server can run a connect flow at all (Phase 7.1). */
  async status(user: AuthUser) {
    return this.creds.status(user.id);
  }

  /**
   * Step one of connecting a mailbox: where to send the browser.
   *
   * `mode` decides the scopes requested — `'read'` for read-only, `'send'` for
   * read + send. The user picks this per mailbox in Settings, so one account
   * can be summarise-only while another is allowed to reply.
   */
  async connectUrl(
    user: AuthUser,
    mode: GmailAccessLevel = 'read',
    returnTo: 'web' | 'app' = 'web',
  ) {
    const creds = await this.creds.forUser(user.id);
    if (!creds) {
      throw new BadRequestException(
        'Gmail sign-in is not set up on this server yet. It needs a Google OAuth app ' +
          '(GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on the API) — see Settings → Mail → Developer setup.',
      );
    }
    return { url: this.oauth.authUrl(creds, user.id, mode, returnTo) };
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
    const userId = this.oauth.verifyState(state)?.userId ?? null;
    if (!userId) throw new BadRequestException('This connect link has expired. Try again.');

    const creds = await this.creds.forUser(userId);
    if (!creds) throw new BadRequestException('Google OAuth is no longer configured.');
    const tokens = await this.oauth.exchangeCode(creds, code);
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

    // Pull in the recent mail now, in the background, so the assistant has
    // something to read the moment you ask — it used to stay empty until
    // someone found "Sync now" in Settings.
    void this.sync.syncUser(userId).catch(() => undefined);

    return { email };
  }

  /** Where a (valid) state says the browser should end up. */
  returnTarget(state: string): 'web' | 'app' {
    return this.oauth.verifyState(state)?.returnTo ?? 'web';
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
        'id, user_id, email, scopes, access_token_enc, refresh_token_enc, token_expires_at, history_id',
      )
      .eq('user_id', input.user_id);

    const { data, error } = input.account_id
      ? await query.eq('id', input.account_id).maybeSingle()
      : await query.order('created_at').limit(1).maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) {
      throw new BadRequestException('No Gmail account is connected — connect one in Settings.');
    }

    const account = data as Parameters<GmailApiService['accessTokenFor']>[0] & {
      email: string;
      scopes: string | null;
    };

    // A read-only mailbox cannot send. Refuse clearly rather than letting Google
    // reject it with an opaque 403 — the fix is to reconnect with send access.
    if (!scopesGrantSend(account.scopes)) {
      throw new BadRequestException(
        `${account.email} is connected read-only. Reconnect it in Settings with ` +
          '"Read & send" access to let MyPro send mail from it.',
      );
    }

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
    // Where this flow started: the web app, or the Android app (system browser).
    const toApp = state ? this.gmail.returnTarget(state) === 'app' : false;
    const back = (params: string) =>
      toApp
        ? res.status(200).type('html').send(appReturnPage(params))
        : res.redirect(`${appUrl.replace(/\/$/, '')}/?${params}`);

    if (error) return back(`gmail=denied`);
    if (!code || !state) return back(`gmail=error`);

    try {
      const { email } = await this.gmail.handleCallback(code, state);
      // The address goes in the fragment-free query only as a confirmation
      // the UI can show; it is the user's own address.
      return back(`gmail=connected&email=${encodeURIComponent(email)}`);
    } catch (err) {
      const expired = err instanceof BadRequestException && /expired/i.test(err.message);
      return back(expired ? `gmail=expired` : `gmail=error`);
    }
  }

  @Get('status')
  @UseGuards(AuthGuard)
  status(@CurrentUser() user: AuthUser) {
    return this.gmail.status(user);
  }

  /** Read-only status of the stored OAuth app credentials (never the secret). */
  @Get('oauth-config')
  @UseGuards(AuthGuard)
  oauthConfig(@CurrentUser() user: AuthUser) {
    return this.gmail.oauthConfigStatus(user);
  }

  /** Save the Google OAuth app credentials (client secret encrypted at rest). */
  @Post('oauth-config')
  @UseGuards(AuthGuard)
  saveOauthConfig(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.gmail.saveOauthConfig(user, oauthConfigInput.parse(body));
  }

  /** Delete the stored credentials (write-only: this is the only way to change them). */
  @Delete('oauth-config')
  @UseGuards(AuthGuard)
  deleteOauthConfig(@CurrentUser() user: AuthUser) {
    return this.gmail.deleteOauthConfig(user);
  }

  @Get('accounts')
  @UseGuards(AuthGuard)
  accounts(@CurrentUser() user: AuthUser) {
    return this.gmail.accounts(user);
  }

  @Post('connect')
  @UseGuards(AuthGuard)
  connect(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { mode, return_to } = connectInput.parse(body ?? {});
    return this.gmail.connectUrl(user, mode, return_to);
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

  /**
   * The laptop asks for fresh mail before the assistant reads the inbox
   * (`list_emails` / `search_emails`). Incremental after the first backfill,
   * so a quiet mailbox costs one small Gmail history call.
   */
  @Post('sync')
  async sync(@Body() body: unknown) {
    const { user_id } = z.object({ user_id: z.string().uuid() }).parse(body);
    // syncNow only reads the id (the sync itself uses the service key).
    return this.gmail.syncNow({ id: user_id } as AuthUser);
  }
}

@Module({
  controllers: [GmailController, GmailInternalController],
  providers: [
    GmailService,
    GmailSyncService,
    GmailApiService,
    GoogleOAuthService,
    GoogleCredsService,
    CryptoService,
    InternalAuthGuard,
  ],
})
export class GmailModule {}
