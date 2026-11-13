import {
  Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SupabaseService } from '../common/supabase.service';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { many, none, one } from '../common/crud';

const annotationKind = z.enum(['note', 'quote', 'summary', 'question', 'highlight']);

const createAnnotation = z.object({
  kind: annotationKind,
  page: z.number().int().min(0).optional(),
  paragraph: z.number().int().min(0).optional(),
  anchor_text: z.string().max(10_000).optional(),
  title: z.string().max(300).optional(),
  body: z.string().max(50_000).optional(),
  color: z.string().max(32).optional(),
  chapter: z.string().max(300).optional(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
});
const patchAnnotation = createAnnotation.partial();

const createBookmark = z.object({
  page: z.number().int().min(0),
  title: z.string().max(300).optional(),
});

const sessionInput = z.object({
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
  start_page: z.number().int().optional(),
  end_page: z.number().int().optional(),
  start_seconds: z.number().int().optional(),
  end_seconds: z.number().int().optional(),
  notes: z.string().max(5000).optional(),
});

@Injectable()
export class ReaderService {
  constructor(private readonly supabase: SupabaseService) {}

  // ---- annotations ----
  async listAnnotations(user: AuthUser, itemId: string) {
    const db = this.supabase.forUser(user.token);
    return many(
      await db
        .from('annotations')
        .select('*, annotation_tags(tag_id)')
        .eq('library_item_id', itemId)
        .order('page', { ascending: true }),
    );
  }

  async createAnnotation(user: AuthUser, itemId: string, input: z.infer<typeof createAnnotation>) {
    const db = this.supabase.forUser(user.token);
    const { tags, ...row } = input;
    const created = one(
      await db
        .from('annotations')
        .insert({ ...row, user_id: user.id, library_item_id: itemId })
        .select('*')
        .single(),
    ) as { id: string };
    if (tags?.length) await this.setTags(user, created.id, tags);
    return created;
  }

  async updateAnnotation(user: AuthUser, id: string, input: z.infer<typeof patchAnnotation>) {
    const db = this.supabase.forUser(user.token);
    const { tags, ...row } = input;
    if (Object.keys(row).length) none(await db.from('annotations').update(row).eq('id', id));
    if (tags) await this.setTags(user, id, tags);
    return one(await db.from('annotations').select('*').eq('id', id).maybeSingle());
  }

  async deleteAnnotation(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return none(await db.from('annotations').delete().eq('id', id));
  }

  /** Tags are a shared vocabulary; create missing ones, then rewrite the junction. */
  private async setTags(user: AuthUser, annotationId: string, names: string[]) {
    const db = this.supabase.forUser(user.token);
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const ids: string[] = [];
    for (const name of unique) {
      const existing = await db.from('tags').select('id').eq('name', name).maybeSingle();
      if (existing.data) {
        ids.push((existing.data as { id: string }).id);
      } else {
        const created = one(
          await db.from('tags').insert({ user_id: user.id, name }).select('id').single(),
        ) as { id: string };
        ids.push(created.id);
      }
    }
    await db.from('annotation_tags').delete().eq('annotation_id', annotationId);
    if (ids.length) {
      none(
        await db
          .from('annotation_tags')
          .insert(ids.map((tag_id) => ({ annotation_id: annotationId, tag_id }))),
      );
    }
  }

  // ---- bookmarks ----
  async listBookmarks(user: AuthUser, itemId: string) {
    const db = this.supabase.forUser(user.token);
    return many(
      await db.from('bookmarks').select('*').eq('library_item_id', itemId).order('page'),
    );
  }

  async createBookmark(user: AuthUser, itemId: string, input: z.infer<typeof createBookmark>) {
    const db = this.supabase.forUser(user.token);
    return one(
      await db
        .from('bookmarks')
        .upsert(
          { ...input, user_id: user.id, library_item_id: itemId },
          { onConflict: 'library_item_id,page' },
        )
        .select('*')
        .single(),
    );
  }

  async deleteBookmark(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return none(await db.from('bookmarks').delete().eq('id', id));
  }

  // ---- sessions ----
  async addSession(
    user: AuthUser,
    itemId: string,
    table: 'reading_sessions' | 'listening_sessions',
    input: z.infer<typeof sessionInput>,
  ) {
    const db = this.supabase.forUser(user.token);
    return one(
      await db
        .from(table)
        .insert({ ...input, user_id: user.id, library_item_id: itemId })
        .select('*')
        .single(),
    );
  }

  // ---- knowledge (derived, never duplicated) ----
  async knowledge(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    const annotations = many(
      await db
        .from('annotations')
        .select('id, kind, page, chapter, title, body, anchor_text, color, created_at, library_item_id, library_items(title)')
        .order('created_at', { ascending: false }),
    );
    const bookmarks = many(
      await db
        .from('bookmarks')
        .select('id, page, title, created_at, library_item_id, library_items(title)')
        .order('created_at', { ascending: false }),
    );
    return { annotations, bookmarks };
  }
}

@Controller('library/:itemId')
@UseGuards(AuthGuard)
export class ReaderItemController {
  constructor(private readonly reader: ReaderService) {}

  @Get('annotations')
  listAnnotations(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.reader.listAnnotations(user, itemId);
  }

  @Post('annotations')
  createAnnotation(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.reader.createAnnotation(user, itemId, createAnnotation.parse(body));
  }

  @Get('bookmarks')
  listBookmarks(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.reader.listBookmarks(user, itemId);
  }

  @Post('bookmarks')
  createBookmark(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.reader.createBookmark(user, itemId, createBookmark.parse(body));
  }

  @Post('reading-sessions')
  readingSession(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.reader.addSession(user, itemId, 'reading_sessions', sessionInput.parse(body));
  }

  @Post('listening-sessions')
  listeningSession(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.reader.addSession(user, itemId, 'listening_sessions', sessionInput.parse(body));
  }
}

@Controller()
@UseGuards(AuthGuard)
export class ReaderController {
  constructor(private readonly reader: ReaderService) {}

  @Patch('annotations/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.reader.updateAnnotation(user, id, patchAnnotation.parse(body));
  }

  @Delete('annotations/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reader.deleteAnnotation(user, id);
  }

  @Delete('bookmarks/:id')
  removeBookmark(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reader.deleteBookmark(user, id);
  }

  @Get('knowledge')
  knowledge(@CurrentUser() user: AuthUser) {
    return this.reader.knowledge(user);
  }
}

@Module({
  controllers: [ReaderItemController, ReaderController],
  providers: [ReaderService],
})
export class ReaderModule {}
