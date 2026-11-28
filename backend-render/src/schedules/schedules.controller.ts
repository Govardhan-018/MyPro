import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { SchedulesService, scheduleInput } from './schedules.service';

@Controller('schedules')
@UseGuards(AuthGuard)
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.schedules.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.schedules.create(user, scheduleInput.parse(body));
  }

  /**
   * Must precede `:id`, or Nest matches 'upcoming' as a schedule id.
   *
   * The phone calls this on every launch and arms a local notification per
   * occurrence (Phase 11.2). 48 hours is the default window: long enough that
   * a day without opening the app loses nothing, short enough that a schedule
   * edited today takes effect tomorrow.
   */
  @Get('upcoming')
  upcoming(
    @CurrentUser() user: AuthUser,
    @Query('hours') hours?: string,
    /** The device's IANA zone, so an all-day item's morning reminder is local. */
    @Query('tz') tz?: string,
  ) {
    const parsed = Number(hours);
    const window = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 168) : 48;
    return this.schedules.upcoming(user, window, tz?.slice(0, 64));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.schedules.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.schedules.update(user, id, scheduleInput.parse(body));
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.schedules.remove(user, id);
  }

  @Get(':id/runs')
  runs(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.schedules.runs(user, id);
  }
}
