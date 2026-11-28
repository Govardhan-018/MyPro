import {
  BadRequestException,
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
  /** Appointment or nudge — one store for both (migration 0025). */
  kind: z.enum(['event', 'reminder']).optional(),
  category_id: z.string().uuid().optional(),
  reminders: z.array(reminder).max(10).optional(),
});
const patchEvent = createEvent.partial();

const SELECT = '*, event_reminders(*), event_categories(name, tone)';

/** PostgREST's answer when a column is missing, i.e. migration 0025 not applied. */
const missingKind = (error: { message: string } | null) =>
  Boolean(error && /kind/.test(error.message) && /column/i.test(error.message));

/**
 * How long after an event starts it may be marked done. "On the day, after the
 * time, roughly a 12-hour window." An all-day event has no start time, so its
 * window is the whole day it falls on.
 */
const DONE_WINDOW_MS = 12 * 60 * 60_000;
const DONE_WINDOW_ALL_DAY_MS = 24 * 60 * 60_000;

/** Whether `now` is inside the window in which `event` may be marked done. */
export function completionWindow(
  event: { starts_at: string; all_day?: boolean | null },
  now: number = Date.now(),
): { open: boolean; reason?: 'too_early' | 'too_late' } {
  const start = new Date(event.starts_at).getTime();
  if (!Number.isFinite(start)) return { open: false, reason: 'too_early' };
  if (now < start) return { open: false, reason: 'too_early' };
  const windowMs = event.all_day ? DONE_WINDOW_ALL_DAY_MS : DONE_WINDOW_MS;
  if (now > start + windowMs) return { open: false, reason: 'too_late' };
  return { open: true };
}

/**
 * Whether an event may still be *edited*. Only before it starts — once the time
 * has passed the event is history (you mark it done or delete it, you do not
 * rewrite it). An all-day event stays editable through its day, since it has no
 * start time to pass.
 */
export function isEventEditable(
  event: { starts_at: string; all_day?: boolean | null },
  now: number = Date.now(),
): boolean {
  const start = new Date(event.starts_at).getTime();
  if (!Number.isFinite(start)) return true;
  const grace = event.all_day ? DONE_WINDOW_ALL_DAY_MS : 0;
  return now < start + grace;
}

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
    const insert = (values: Record<string, unknown>) =>
      db.from('calendar_events').insert({ ...values, user_id: user.id }).select('id').single();
    let res = await insert(row);
    // Without migration 0025 a reminder is stored as a plain event, not lost.
    if (missingKind(res.error)) {
      const { kind: _kind, ...legacy } = row;
      res = await insert(legacy);
    }
    const created = one(res) as { id: string };
    await this.replaceReminders(user, created.id, reminders);
    return this.get(user, created.id);
  }

  async update(user: AuthUser, id: string, input: z.infer<typeof patchEvent>) {
    const db = this.supabase.forUser(user.token);

    // An event may only be edited before it starts. After that it is history:
    // mark it done or delete it. The UI disables the form, and this is the same
    // rule on the server so it holds however the request arrives.
    const existing = (await this.get(user, id)) as {
      starts_at: string;
      all_day: boolean | null;
    } | null;
    if (existing && !isEventEditable(existing)) {
      throw new BadRequestException(
        'This event has already started and can no longer be edited. You can mark it done or delete it.',
      );
    }

    const { reminders, ...row } = input;
    if (Object.keys(row).length) {
      let { error } = await db.from('calendar_events').update(row).eq('id', id);
      if (missingKind(error)) {
        const { kind: _kind, ...legacy } = row;
        error = Object.keys(legacy).length
          ? (await db.from('calendar_events').update(legacy).eq('id', id)).error
          : null;
      }
      none({ error });
    }
    if (reminders) await this.replaceReminders(user, id, reminders);
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    // Past events delete exactly like any other — the only time rule in the
    // calendar is the completion window below.
    return none(await db.from('calendar_events').delete().eq('id', id));
  }

  /**
   * Mark an event done. The backend is the authority on *when* this is allowed:
   * only once the event has started, and only for ~12 hours after (a day, for
   * all-day events). The UI hides the button outside that window, but the rule
   * lives here so it holds however the request arrives.
   */
  async complete(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    const event = (await this.get(user, id)) as {
      starts_at: string;
      all_day: boolean | null;
    } | null;
    if (!event) throw new BadRequestException('Event not found');

    const window = completionWindow(event);
    if (!window.open) {
      throw new BadRequestException(
        window.reason === 'too_early'
          ? "You can mark this done once it has started."
          : 'The window to mark this done has passed.',
      );
    }

    none(
      await db
        .from('calendar_events')
        .update({ completed_at: new Date().toISOString() })
        .eq('id', id),
    );
    return this.get(user, id);
  }

  /** Clear a completion. Always allowed — undoing a mistake is never late. */
  async uncomplete(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    none(await db.from('calendar_events').update({ completed_at: null }).eq('id', id));
    return this.get(user, id);
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

  /** Mark done (guarded by the completion window in the service). */
  @Post(':id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.calendar.complete(user, id);
  }

  /** Clear a completion. */
  @Delete(':id/complete')
  uncomplete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.calendar.uncomplete(user, id);
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
