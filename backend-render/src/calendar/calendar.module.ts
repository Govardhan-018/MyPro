import {
  Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SupabaseService } from '../common/supabase.service';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { many, none, one } from '../common/crud';

const reminder = z.object({
  minutes_before: z.number().int().min(0).max(40_320),
  channel: z.enum(['push', 'telegram', 'email', 'in_app']).default('push'),
});

const createEvent = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime().optional(),
  all_day: z.boolean().default(false),
  location: z.string().max(300).optional(),
  category_id: z.string().uuid().optional(),
  reminders: z.array(reminder).max(10).optional(),
});
const patchEvent = createEvent.partial();

const SELECT = '*, event_reminders(*), event_categories(name, tone)';

@Injectable()
export class CalendarService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(user: AuthUser, from?: string, to?: string) {
    const db = this.supabase.forUser(user.token);
    let q = db.from('calendar_events').select(SELECT).order('starts_at');
    if (from) q = q.gte('starts_at', from);
    if (to) q = q.lte('starts_at', to);
    return many(await q);
  }

  async get(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return one(await db.from('calendar_events').select(SELECT).eq('id', id).maybeSingle());
  }

  async create(user: AuthUser, input: z.infer<typeof createEvent>) {
    const db = this.supabase.forUser(user.token);
    const { reminders, ...row } = input;
    const created = one(
      await db.from('calendar_events').insert({ ...row, user_id: user.id }).select('id').single(),
    ) as { id: string };
    await this.replaceReminders(user, created.id, reminders);
    return this.get(user, created.id);
  }

  async update(user: AuthUser, id: string, input: z.infer<typeof patchEvent>) {
    const db = this.supabase.forUser(user.token);
    const { reminders, ...row } = input;
    if (Object.keys(row).length) none(await db.from('calendar_events').update(row).eq('id', id));
    if (reminders) await this.replaceReminders(user, id, reminders);
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return none(await db.from('calendar_events').delete().eq('id', id));
  }

  private async replaceReminders(user: AuthUser, eventId: string, list?: z.infer<typeof reminder>[]) {
    const db = this.supabase.forUser(user.token);
    await db.from('event_reminders').delete().eq('calendar_event_id', eventId);
    if (!list?.length) return;
    none(
      await db
        .from('event_reminders')
        .insert(list.map((r) => ({ ...r, calendar_event_id: eventId }))),
    );
  }

  async categories(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    return many(await db.from('event_categories').select('*').order('name'));
  }

  async createCategory(user: AuthUser, name: string, tone?: string) {
    const db = this.supabase.forUser(user.token);
    return one(
      await db
        .from('event_categories')
        .insert({ user_id: user.id, name, tone })
        .select('*')
        .single(),
    );
  }

  async deleteCategory(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return none(await db.from('event_categories').delete().eq('id', id));
  }
}

@Controller('calendar/events')
@UseGuards(AuthGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.calendar.list(user, from, to);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.calendar.create(user, createEvent.parse(body));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.calendar.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.calendar.update(user, id, patchEvent.parse(body));
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.calendar.remove(user, id);
  }
}

@Controller('calendar/categories')
@UseGuards(AuthGuard)
export class CalendarCategoriesController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.calendar.categories(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { name, tone } = z
      .object({ name: z.string().min(1).max(80), tone: z.string().max(40).optional() })
      .parse(body);
    return this.calendar.createCategory(user, name, tone);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.calendar.deleteCategory(user, id);
  }
}

@Module({
  controllers: [CalendarController, CalendarCategoriesController],
  providers: [CalendarService],
})
export class CalendarModule {}
