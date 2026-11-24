import { Injectable, Logger } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { SupabaseService } from '../common/supabase.service';
import { env } from '../config/env';
import type { AuthUser } from '../common/auth.guard';

/**
 * A short-lived session *as the user*, for work the user scheduled.
 *
 * A scheduled "AI message" must run with the same powers — and the same
 * row-level security — as the user typing it into the chat at that moment:
 * the agent's skills read and write through `forUser(token)`. There is no
 * user request in flight at 08:30, so there is no token. Rather than widen the
 * agent to the secret key (bypassing RLS for an LLM-driven tool loop), the
 * server mints a normal session for exactly this run:
 *
 *   admin.generateLink(magiclink)  →  verifyOtp(token_hash)  →  session
 *
 * No email is sent (generateLink only returns the link). The session is
 * revoked as soon as the run ends, so nothing outlives the task. Only ever
 * called for a schedule the user owns, keyed by that row's `user_id`.
 */
@Injectable()
export class UserSessionBroker {
  private readonly logger = new Logger(UserSessionBroker.name);

  constructor(private readonly supabase: SupabaseService) {}

  async withUser<T>(userId: string, work: (user: AuthUser) => Promise<T>): Promise<T> {
    const admin = this.supabase.admin;
    const { data: found, error: lookupError } = await admin.auth.admin.getUserById(userId);
    const email = found?.user?.email;
    if (lookupError || !email) {
      throw new Error(`cannot act as this user (${lookupError?.message ?? 'no email on account'})`);
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      throw new Error(`could not open a session (${linkError?.message ?? 'no token'})`);
    }

    const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = env();
    const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    });
    const token = verified?.session?.access_token;
    if (verifyError || !token) {
      throw new Error(`could not open a session (${verifyError?.message ?? 'no session'})`);
    }

    try {
      return await work({ id: userId, email, token });
    } finally {
      const { error } = await admin.auth.admin.signOut(token, 'local');
      if (error) this.logger.warn(`could not revoke the scheduled-run session: ${error.message}`);
    }
  }
}
