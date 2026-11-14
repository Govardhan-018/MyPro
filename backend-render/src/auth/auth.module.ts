import { Body, Controller, HttpException, HttpStatus, Injectable, Module, Post } from '@nestjs/common';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
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

interface SessionDto {
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
  user: { id: string; email: string | null };
}

@Injectable()
export class AuthService {
  private readonly client: SupabaseClient;

  constructor() {
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
    if (error || !data.session) {
      throw new HttpException('Session expired', HttpStatus.UNAUTHORIZED);
    }
    return { session: this.toDto(data.session) };
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
}

@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
