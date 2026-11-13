import {
  Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SupabaseService } from '../common/supabase.service';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { many, none, one } from '../common/crud';

const registerDevice = z.object({
  channel_type: z.enum(['web_push', 'fcm', 'telegram']),
  token: z.string().min(4).max(4000),
  platform: z.string().max(60).optional(),
});

@Injectable()
export class NotificationsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(user: AuthUser, unreadOnly: boolean) {
    const db = this.supabase.forUser(user.token);
    let q = db.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
    if (unreadOnly) q = q.is('read_at', null);
    return many(await q);
  }

  async markRead(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return one(
      await db
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single(),
    );
  }

  async markAllRead(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    return none(
      await db
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .is('read_at', null),
    );
  }

  async devices(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    return many(await db.from('device_tokens').select('id, channel_type, platform, last_seen_at'));
  }

  async registerDevice(user: AuthUser, input: z.infer<typeof registerDevice>) {
    const db = this.supabase.forUser(user.token);
    return one(
      await db
        .from('device_tokens')
        .upsert(
          { ...input, user_id: user.id, last_seen_at: new Date().toISOString() },
          { onConflict: 'user_id,token' },
        )
        .select('id, channel_type, platform')
        .single(),
    );
  }

  async removeDevice(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return none(await db.from('device_tokens').delete().eq('id', id));
  }

  async channels(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    return many(await db.from('notification_channels').select('*'));
  }

  async setChannel(user: AuthUser, type: string, enabled: boolean) {
    const db = this.supabase.forUser(user.token);
    return one(
      await db
        .from('notification_channels')
        .upsert({ user_id: user.id, type, enabled }, { onConflict: 'user_id,type' })
        .select('*')
        .single(),
    );
  }
}

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    return this.notifications.list(user, unread === 'true');
  }

  @Patch('read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }

  @Patch(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user, id);
  }
}

@Controller('devices')
@UseGuards(AuthGuard)
export class DevicesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.devices(user);
  }

  @Post()
  register(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.notifications.registerDevice(user, registerDevice.parse(body));
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.removeDevice(user, id);
  }

  @Get('channels')
  channels(@CurrentUser() user: AuthUser) {
    return this.notifications.channels(user);
  }

  @Post('channels')
  setChannel(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { type, enabled } = z
      .object({
        type: z.enum(['web_push', 'fcm', 'telegram', 'email']),
        enabled: z.boolean(),
      })
      .parse(body);
    return this.notifications.setChannel(user, type, enabled);
  }
}

@Module({
  controllers: [NotificationsController, DevicesController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
