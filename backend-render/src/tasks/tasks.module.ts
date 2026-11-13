import {
  Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SupabaseService } from '../common/supabase.service';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { many, none, one } from '../common/crud';

const createTask = z.object({
  title: z.string().min(1).max(300),
  notes: z.string().max(10_000).optional(),
  due_at: z.string().datetime().optional(),
  status: z.enum(['open', 'done', 'dropped']).default('open'),
  priority: z.number().int().min(0).max(3).default(0),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
});
const patchTask = createTask.partial();

const SELECT = '*, task_tags(tag_id)';

@Injectable()
export class TasksService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(user: AuthUser, status?: string) {
    const db = this.supabase.forUser(user.token);
    let q = db.from('tasks').select(SELECT).order('due_at', { ascending: true, nullsFirst: false });
    if (status) q = q.eq('status', status);
    return many(await q);
  }

  async create(user: AuthUser, input: z.infer<typeof createTask>) {
    const db = this.supabase.forUser(user.token);
    const { tags, ...row } = input;
    const created = one(
      await db.from('tasks').insert({ ...row, user_id: user.id }).select('*').single(),
    ) as { id: string };
    if (tags?.length) await this.setTags(user, created.id, tags);
    return this.get(user, created.id);
  }

  async get(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return one(await db.from('tasks').select(SELECT).eq('id', id).maybeSingle());
  }

  async update(user: AuthUser, id: string, input: z.infer<typeof patchTask>) {
    const db = this.supabase.forUser(user.token);
    const { tags, ...row } = input;
    if (Object.keys(row).length) none(await db.from('tasks').update(row).eq('id', id));
    if (tags) await this.setTags(user, id, tags);
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return none(await db.from('tasks').delete().eq('id', id));
  }

  private async setTags(user: AuthUser, taskId: string, names: string[]) {
    const db = this.supabase.forUser(user.token);
    const ids: string[] = [];
    for (const name of [...new Set(names.map((n) => n.trim()).filter(Boolean))]) {
      const existing = await db.from('tags').select('id').eq('name', name).maybeSingle();
      if (existing.data) ids.push((existing.data as { id: string }).id);
      else {
        const created = one(
          await db.from('tags').insert({ user_id: user.id, name }).select('id').single(),
        ) as { id: string };
        ids.push(created.id);
      }
    }
    await db.from('task_tags').delete().eq('task_id', taskId);
    if (ids.length) {
      none(await db.from('task_tags').insert(ids.map((tag_id) => ({ task_id: taskId, tag_id }))));
    }
  }
}

@Controller('tasks')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.tasks.list(user, status);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.tasks.create(user, createTask.parse(body));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.tasks.update(user, id, patchTask.parse(body));
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.remove(user, id);
  }
}

@Module({ controllers: [TasksController], providers: [TasksService] })
export class TasksModule {}
