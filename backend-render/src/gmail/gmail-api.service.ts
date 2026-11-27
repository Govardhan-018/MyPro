import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { CryptoService } from '../common/crypto.service';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleCredsService } from './google-creds.service';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailHeaderSet {
  from: string | null;
  to: string | null;
  subject: string | null;
}

export interface GmailMessage {
  id: string;
  threadId: string | null;
  labelIds: string[];
  snippet: string | null;
  internalDate: Date | null;
  headers: GmailHeaderSet;
}

interface AccountRow {
  id: string;
  user_id: string;
  email: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  history_id: string | null;
}

/**
 * Raised when a mailbox can no longer be reached without the user's help —
 * the refresh token was revoked, or expired because the OAuth app is still
 * in *Testing* (the 7-day trap). The caller records it on the account so the
 * UI can say "reconnect" instead of showing an empty inbox.
 */
export class GmailReauthRequired extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'GmailReauthRequired';
  }
}

/**
 * Talking to Gmail — Phase 7.4/7.6.
 *
 * Every call goes through {@link accessTokenFor}, which refreshes and
 * re-encrypts as needed, so no caller ever handles a raw token. Nothing here
 * touches our own tables beyond the token columns; shaping messages into rows
 * is the sync service's job.
 */
@Injectable()
export class GmailApiService {
  private readonly logger = new Logger(GmailApiService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly crypto: CryptoService,
    private readonly oauth: GoogleOAuthService,
    private readonly creds: GoogleCredsService,
  ) {}

  /**
   * A usable access token for this account, refreshing it first if it is
   * within its expiry window.
   *
   * Refreshed tokens are written straight back encrypted: Google rotates the
   * access token on every refresh, and keeping the stale one would mean a
   * refresh round-trip on literally every request.
   */
  async accessTokenFor(account: AccountRow): Promise<string> {
    const current = this.crypto.decrypt(account.access_token_enc);
    const expires = account.token_expires_at ? new Date(account.token_expires_at) : null;

    if (current && expires && expires.getTime() > Date.now()) return current;

    const refreshToken = this.crypto.decrypt(account.refresh_token_enc);
    if (!refreshToken) {
      throw new GmailReauthRequired(
        'No usable refresh token — reconnect this mailbox. If this keeps happening weekly, ' +
          'the Google OAuth app is still in Testing.',
      );
    }

    const creds = await this.creds.forUser(account.user_id);
    if (!creds) {
      throw new GmailReauthRequired(
        'Google OAuth is not configured. Add the app credentials in Settings → Mail.',
      );
    }

    try {
      const tokens = await this.oauth.refresh(creds, refreshToken);
      await this.supabase.admin
        .from('gmail_accounts')
        .update({
          access_token_enc: this.crypto.encrypt(tokens.accessToken),
          token_expires_at: tokens.expiresAt.toISOString(),
          // Google usually omits it on refresh; never overwrite with null.
          ...(tokens.refreshToken
            ? { refresh_token_enc: this.crypto.encrypt(tokens.refreshToken) }
            : {}),
          sync_error: null,
        })
        .eq('id', account.id);
      return tokens.accessToken;
    } catch (err) {
      throw new GmailReauthRequired(
        err instanceof Error ? err.message : 'Could not refresh the mailbox token',
      );
    }
  }

  /** Message ids, newest first. `pageToken` walks the backfill. */
  async listMessageIds(
    token: string,
    options: { pageToken?: string; max?: number; query?: string } = {},
  ): Promise<{ ids: string[]; nextPageToken: string | null }> {
    const params = new URLSearchParams({ maxResults: String(options.max ?? 50) });
    if (options.pageToken) params.set('pageToken', options.pageToken);
    if (options.query) params.set('q', options.query);

    const body = await this.call<{
      messages?: { id: string }[];
      nextPageToken?: string;
    }>(token, `/messages?${params.toString()}`);

    return {
      ids: (body.messages ?? []).map((m) => m.id),
      nextPageToken: body.nextPageToken ?? null,
    };
  }

  /**
   * One message, metadata only.
   *
   * `format=metadata` with a header whitelist is a deliberate limit: MyPro
   * stores who/what/when and Gmail's own snippet, never the body. Bodies are
   * the bulk of a mailbox, they are the most sensitive thing in it, and the
   * assistant's summaries work from the snippet. Not fetching them keeps the
   * database inside the free tier and keeps the blast radius small.
   */
  async getMessage(token: string, id: string): Promise<GmailMessage | null> {
    const params = new URLSearchParams({ format: 'metadata' });
    for (const header of ['From', 'To', 'Subject']) params.append('metadataHeaders', header);

    const body = await this.call<{
      id: string;
      threadId?: string;
      labelIds?: string[];
      snippet?: string;
      internalDate?: string;
      payload?: { headers?: { name: string; value: string }[] };
    }>(token, `/messages/${id}?${params.toString()}`).catch((err) => {
      if (err instanceof GmailReauthRequired) throw err;
      // A single unreadable message must not abort a 500-message backfill.
      this.logger.warn(`could not read message ${id}`);
      return null;
    });
    if (!body) return null;

    const header = (name: string): string | null =>
      body.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? null;

    return {
      id: body.id,
      threadId: body.threadId ?? null,
      labelIds: body.labelIds ?? [],
      snippet: body.snippet ?? null,
      internalDate: body.internalDate ? new Date(Number(body.internalDate)) : null,
      headers: { from: header('from'), to: header('to'), subject: header('subject') },
    };
  }

  /**
   * What changed since `historyId` — the incremental path (Phase 7.4).
   *
   * Gmail expires history older than roughly a week. A 404 here is not an
   * error but an instruction: the cursor is too old, start a fresh backfill.
   */
  async historySince(
    token: string,
    historyId: string,
  ): Promise<{ ids: string[]; historyId: string | null; expired: boolean }> {
    const params = new URLSearchParams({
      startHistoryId: historyId,
      historyTypes: 'messageAdded',
    });

    try {
      const body = await this.call<{
        history?: { messagesAdded?: { message: { id: string } }[] }[];
        historyId?: string;
      }>(token, `/history?${params.toString()}`);

      const ids = (body.history ?? []).flatMap((entry) =>
        (entry.messagesAdded ?? []).map((added) => added.message.id),
      );
      return { ids: [...new Set(ids)], historyId: body.historyId ?? null, expired: false };
    } catch (err) {
      if (err instanceof GmailHistoryExpired) return { ids: [], historyId: null, expired: true };
      throw err;
    }
  }

  /** The mailbox's current history cursor, for the end of a backfill. */
  async currentHistoryId(token: string): Promise<string | null> {
    const body = await this.call<{ historyId?: string }>(token, '/profile');
    return body.historyId ?? null;
  }

  /**
   * Send as the user — Phase 7.6.
   *
   * RFC 2822, base64url. Only ever reached after an explicit approval: the
   * skill executor parks `send_email` in `pending_actions` and nothing here
   * can be triggered by the model on its own.
   */
  async send(
    token: string,
    message: { to: string; subject: string; body: string; from?: string },
  ): Promise<{ id: string }> {
    const sent = await this.call<{ id: string }>(token, '/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw: buildRawMessage(message) }),
    });
    return { id: sent.id };
  }

  private async call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      // Google explains itself in the body; keep that, it is the whole fix.
      const detail = await googleError(res);
      if (res.status === 401) {
        throw new GmailReauthRequired(`Gmail rejected the sign-in (${detail}). Reconnect this mailbox.`);
      }
      if (res.status === 403 && /insufficient|scope|permission/i.test(detail)) {
        throw new BadRequestException(
          `This mailbox was connected without permission to send (${detail}). Reconnect it with "Read & send".`,
        );
      }
      if (res.status === 403) throw new GmailReauthRequired(`Gmail refused the request (${detail}).`);
      if (res.status === 404 && path.startsWith('/history')) throw new GmailHistoryExpired();
      throw new BadRequestException(`Gmail could not ${path.includes('send') ? 'send it' : 'do that'}: ${detail}`);
    }

    return (await res.json()) as T;
  }
}

/** The history cursor is older than Gmail keeps; backfill instead. */
class GmailHistoryExpired extends Error {
  constructor() {
    super('Gmail history cursor has expired');
    this.name = 'GmailHistoryExpired';
  }
}

/** Google's own error text, e.g. "Invalid To header" — never a token. */
async function googleError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } };
    const message = body.error?.message?.trim();
    if (message) return `${res.status}: ${message.slice(0, 300)}`;
  } catch {
    /* not JSON */
  }
  return String(res.status);
}

/**
 * RFC 2047 encoded-word for a header that is not plain ASCII — otherwise an
 * em dash, a curly apostrophe, an emoji or any non-Latin script in an
 * AI-written subject arrives as mojibake. Split into chunks so no encoded
 * word exceeds 75 characters, never splitting a UTF-8 character.
 */
export function encodeHeaderValue(value: string): string {
  const clean = sanitizeHeader(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const words: string[] = [];
  let chunk = '';
  for (const ch of clean) {
    // 45 bytes of UTF-8 → 60 chars of base64, + "=?UTF-8?B?" and "?=" = 72.
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/**
 * The message Gmail's `messages.send` takes: RFC 2822 with CRLF line endings,
 * an encoded subject, and the body base64-encoded in 76-character lines (so
 * any text — long lines, emoji, any script — survives transport), all of it
 * base64url-encoded. Pure; unit-tested by decoding it back.
 */
export function buildRawMessage(message: {
  to: string;
  subject: string;
  body: string;
  from?: string;
  date?: Date;
}): string {
  const body = message.body.replace(/\r\n|\r|\n/g, '\r\n');
  const encodedBody = (Buffer.from(body, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
  const headers = [
    `To: ${sanitizeHeader(message.to)}`,
    ...(message.from ? [`From: ${sanitizeHeader(message.from)}`] : []),
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${(message.date ?? new Date()).toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${encodedBody}\r\n`, 'utf8').toString('base64url');
}

/**
 * A newline in a header value is header injection: it would let a crafted
 * subject add `Bcc:` recipients. Strip CR and LF rather than escaping, since
 * neither belongs in any of the headers we build.
 */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}
