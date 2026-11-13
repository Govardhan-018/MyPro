import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
