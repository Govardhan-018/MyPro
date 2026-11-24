import {
  Body, Controller, Headers, HttpCode, HttpException, HttpStatus, Injectable, Logger, Module, Post,
} from '@nestjs/common';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../common/supabase.service';
import { z } from 'zod';
import { env } from '../config/env';

/**
 * Auth broker. The web/app clients never hold Supabase credentials — they send
 * email/password (or a refresh token) here, and Render talks to Supabase on
 * their behalf and returns the session tokens. The access token is then used as
 * the Bearer for every other render + backend-local call, exactly as before
 * (both verify it against Supabase's JWKS). This is what lets a client be
 * configured with nothing but the Render URL.
 */

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
});
const refreshInput = z.object({ refresh_token: z.string().min(10) });

/**
 * Whether a Supabase auth error means the refresh token itself is dead
 * (revoked, rotated, signed out elsewhere) as opposed to Supabase being
 * unreachable or erroring.
 *
 * The distinction is the whole of session durability: the client signs the
 * user out on a 401 from `/auth/refresh` and keeps the session on anything
 * else. Mapping a Supabase outage or a network blip to 401 — as this used to —
 * logs everyone out the moment Supabase hiccups.
 */
export function refreshErrorIsFatal(error: { status?: number; name?: string } | null): boolean {
  if (!error) return false;
  // supabase-js marks network/timeouts as retryable (status 0 or 5xx).
  if (error.name === 'AuthRetryableFetchError') return false;
  const status = typeof error.status === 'number' ? error.status : 0;
  return status >= 400 && status < 500;
}

interface SessionDto {
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
  user: { id: string; email: string | null };
}

@Injectable()
export class AuthService {
  private readonly client: SupabaseClient;
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly supabase: SupabaseService) {
    const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = env();
    // Anon client, no session persistence — this process just relays auth calls.
    this.client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private toDto(session: Session): SessionDto {
    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? null,
      user: { id: session.user.id, email: session.user.email ?? null },
    };
  }

  async signup(email: string, password: string) {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    // When email confirmation is on, there is no session yet.
    if (!data.session) return { session: null, needs_confirmation: true };
    return { session: this.toDto(data.session), needs_confirmation: false };
  }

  async login(email: string, password: string) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
    if (!data.session) throw new HttpException('Sign-in failed', HttpStatus.UNAUTHORIZED);
    return { session: this.toDto(data.session) };
  }

  async refresh(refreshToken: string) {
    const { data, error } = await this.client.auth.refreshSession({ refresh_token: refreshToken });
    if (error && !refreshErrorIsFatal(error)) {
      this.logger.warn(`refresh failed transiently: ${error.message}`);
      throw new HttpException('Auth is temporarily unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (error || !data.session) {
      throw new HttpException('Session expired', HttpStatus.UNAUTHORIZED);
    }
    return { session: this.toDto(data.session) };
  }

  /**
   * Revoke this device's session server-side, so its refresh token stops
   * working immediately — signing out must not leave a still-valid refresh
   * token behind in storage or a backup. `'local'` scope: other devices stay
   * signed in. Best effort: the client has already cleared its copy.
   */
  async logout(accessToken: string | null): Promise<void> {
    if (!accessToken) return;
    const { error } = await this.supabase.admin.auth.admin.signOut(accessToken, 'local');
    if (error) this.logger.warn(`logout revoke failed: ${error.message}`);
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  signup(@Body() body: unknown) {
    const { email, password } = credentials.parse(body);
    return this.auth.signup(email, password);
  }

  @Post('login')
  login(@Body() body: unknown) {
    const { email, password } = credentials.parse(body);
    return this.auth.login(email, password);
  }

  @Post('refresh')
  refresh(@Body() body: unknown) {
    const { refresh_token } = refreshInput.parse(body);
    return this.auth.refresh(refresh_token);
  }

  /** No AuthGuard: an already-expired access token must still be able to sign out. */
  @Post('logout')
  @HttpCode(204)
  async logout(@Headers('authorization') authorization?: string) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    await this.auth.logout(token);
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
