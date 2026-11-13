import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

/**
 * Two kinds of database access, deliberately separated:
 *
 *  - `forUser(jwt)`  → publishable key + the caller's JWT. **RLS applies.**
 *                      The default for anything acting on the user's behalf.
 *  - `admin`         → secret key. **Bypasses RLS.** Only for background work
 *                      with no user request in flight (the heartbeat, receipts),
 *                      and always filtered by user_id explicitly.
 */
@Injectable()
export class SupabaseService {
  private readonly adminClient: SupabaseClient;

  constructor() {
    const { SUPABASE_URL, SUPABASE_SECRET_KEY } = env();
    this.adminClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Secret-key client. Bypasses RLS — filter by user_id yourself. */
  get admin(): SupabaseClient {
    return this.adminClient;
  }

  /** User-scoped client; every query is constrained by RLS. */
  forUser(accessToken: string): SupabaseClient {
    const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = env();
    return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }
}
