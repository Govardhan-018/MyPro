import { Body, Controller, Get, Injectable, Module, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { SupabaseService } from '../common/supabase.service';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { one } from '../common/crud';

const profilePatch = z.object({
  display_name: z.string().max(120).optional(),
  avatar_url: z.string().url().max(500).optional(),
  timezone: z.string().max(64).optional(),
  locale: z.string().max(16).optional(),
  color_mode: z.boolean().optional(),
});

@Injectable()
export class ProfileService {
  constructor(private readonly supabase: SupabaseService) {}

  async get(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    const res = await db.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
    if (res.data) return res.data;
    return one(await db.from('profiles').insert({ user_id: user.id }).select('*').single());
  }

  async update(user: AuthUser, patch: z.infer<typeof profilePatch>) {
    const db = this.supabase.forUser(user.token);
    await this.get(user);
    return one(
      await db.from('profiles').update(patch).eq('user_id', user.id).select('*').single(),
    );
  }

  /** Heartbeat from any client — drives the "you went quiet" nudge. */
  async heartbeat(user: AuthUser, client: string) {
    const db = this.supabase.forUser(user.token);
    const now = new Date().toISOString();
    const existing = await db.from('user_activity').select('user_id').eq('user_id', user.id).maybeSingle();
    if (existing.data) {
      await db
        .from('user_activity')
        .update({ last_active_at: now, last_seen_client: client, inactive_notified_at: null })
        .eq('user_id', user.id);
    } else {
      await db
        .from('user_activity')
        .insert({ user_id: user.id, last_active_at: now, last_seen_client: client });
    }
    return { ok: true, at: now };
  }
}

@Controller('me')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.profile.get(user);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.profile.update(user, profilePatch.parse(body));
  }

  @Post('activity')
  activity(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { client } = z.object({ client: z.string().max(32).default('web') }).parse(body ?? {});
    return this.profile.heartbeat(user, client);
  }
}

@Module({ controllers: [ProfileController], providers: [ProfileService] })
export class ProfileModule {}
