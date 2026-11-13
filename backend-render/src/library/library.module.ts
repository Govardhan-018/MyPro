import {
  Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SupabaseService } from '../common/supabase.service';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { many, none, one } from '../common/crud';

const itemType = z.enum(['book', 'podcast', 'article', 'note']);

const DETAIL_TABLE: Record<z.infer<typeof itemType>, string> = {
  book: 'book_details',
  podcast: 'podcast_details',
  article: 'article_details',
  note: 'note_details',
};

const bookDetails = z.object({
  total_pages: z.number().int().positive().optional(),
  current_page: z.number().int().min(0).optional(),
  is_physical: z.boolean().optional(),
  pdf_filename: z.string().max(300).optional(),
  pdf_storage: z.enum(['device', 'sync']).optional(),
  pdf_json_path: z.string().max(500).optional(),
  sync_status: z.enum(['local', 'synced', 'uploading', 'pending']).optional(),
  file_size_bytes: z.number().int().nonnegative().optional(),
});
const podcastDetails = z.object({
  youtube_url: z.string().url().max(500).optional(),
  channel: z.string().max(200).optional(),
  episode_title: z.string().max(300).optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  current_time_seconds: z.number().int().nonnegative().optional(),
  playback_speed: z.number().min(0.25).max(4).optional(),
});
const articleDetails = z.object({
  source_url: z.string().url().max(500).optional(),
  author: z.string().max(200).optional(),
  read_time_minutes: z.number().int().nonnegative().optional(),
  content_ref: z.string().max(500).optional(),
});
const noteDetails = z.object({ body: z.string().max(100_000).optional() });

const createItem = z.object({
  type: itemType,
  title: z.string().min(1).max(300),
  creator: z.string().max(200).optional(),
  status: z.enum(['in_progress', 'completed', 'want', 'favorite']).default('want'),
  progress: z.number().int().min(0).max(100).default(0),
  cover_url: z.string().max(1000).optional(),
  tone: z.string().max(40).optional(),
  details: z.record(z.unknown()).optional(),
});

const patchItem = createItem.partial().omit({ type: true });

const SELECT = '*, book_details(*), podcast_details(*), article_details(*), note_details(*)';

function parseDetails(type: z.infer<typeof itemType>, raw: unknown) {
  if (raw === undefined) return undefined;
  switch (type) {
    case 'book': return bookDetails.parse(raw);
    case 'podcast': return podcastDetails.parse(raw);
    case 'article': return articleDetails.parse(raw);
    case 'note': return noteDetails.parse(raw);
  }
}

@Injectable()
export class LibraryService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(user: AuthUser, filters: { type?: string; status?: string; q?: string }) {
    const db = this.supabase.forUser(user.token);
    let q = db.from('library_items').select(SELECT).order('accessed_at', { ascending: false, nullsFirst: false });
    if (filters.type) q = q.eq('type', filters.type);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.q) q = q.or(`title.ilike.%${filters.q}%,creator.ilike.%${filters.q}%`);
    return many(await q);
  }

  async get(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return one(await db.from('library_items').select(SELECT).eq('id', id).maybeSingle());
  }

  async create(user: AuthUser, input: z.infer<typeof createItem>) {
    const db = this.supabase.forUser(user.token);
    const { details, ...item } = input;
    const created = one(
      await db
        .from('library_items')
        .insert({ ...item, user_id: user.id, accessed_at: new Date().toISOString() })
        .select('id')
        .single(),
    ) as { id: string };

    const parsed = parseDetails(input.type, details ?? {});
    if (parsed) {
      none(
        await db
          .from(DETAIL_TABLE[input.type])
          .insert({ ...parsed, library_item_id: created.id }),
      );
    }
    return this.get(user, created.id);
  }

  async update(user: AuthUser, id: string, input: z.infer<typeof patchItem>) {
    const db = this.supabase.forUser(user.token);
    const existing = (await this.get(user, id)) as { type: z.infer<typeof itemType> };
    const { details, ...item } = input;

    if (Object.keys(item).length) {
      none(await db.from('library_items').update(item).eq('id', id));
    }
    const parsed = parseDetails(existing.type, details);
    if (parsed && Object.keys(parsed).length) {
      const table = DETAIL_TABLE[existing.type];
      const row = await db.from(table).select('library_item_id').eq('library_item_id', id).maybeSingle();
      if (row.data) none(await db.from(table).update(parsed).eq('library_item_id', id));
      else none(await db.from(table).insert({ ...parsed, library_item_id: id }));
    }
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return none(await db.from('library_items').delete().eq('id', id));
  }

  // ---- collections ----
  async collections(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    return many(
      await db
        .from('collections')
        .select('*, collection_items(library_item_id)')
        .order('sort_order'),
    );
  }

  async createCollection(user: AuthUser, name: string, sortOrder: number) {
    const db = this.supabase.forUser(user.token);
    return one(
      await db
        .from('collections')
        .insert({ user_id: user.id, name, sort_order: sortOrder })
        .select('*')
        .single(),
    );
  }

  async renameCollection(user: AuthUser, id: string, patch: { name?: string; sort_order?: number }) {
    const db = this.supabase.forUser(user.token);
    return one(await db.from('collections').update(patch).eq('id', id).select('*').single());
  }

  async deleteCollection(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return none(await db.from('collections').delete().eq('id', id));
  }

  async addToCollection(user: AuthUser, collectionId: string, itemId: string) {
    const db = this.supabase.forUser(user.token);
    return none(
      await db
        .from('collection_items')
        .upsert({ collection_id: collectionId, library_item_id: itemId }),
    );
  }

  async removeFromCollection(user: AuthUser, collectionId: string, itemId: string) {
    const db = this.supabase.forUser(user.token);
    return none(
      await db
        .from('collection_items')
        .delete()
        .eq('collection_id', collectionId)
        .eq('library_item_id', itemId),
    );
  }
}

@Controller('library')
@UseGuards(AuthGuard)
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.library.list(user, { type, status, q });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.library.create(user, createItem.parse(body));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.library.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.library.update(user, id, patchItem.parse(body));
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.library.remove(user, id);
  }
}

@Controller('collections')
@UseGuards(AuthGuard)
export class CollectionsController {
  constructor(private readonly library: LibraryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.library.collections(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { name, sort_order } = z
      .object({ name: z.string().min(1).max(120), sort_order: z.number().int().default(0) })
      .parse(body);
    return this.library.createCollection(user, name, sort_order);
  }

  @Patch(':id')
  rename(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const patch = z
      .object({ name: z.string().min(1).max(120).optional(), sort_order: z.number().int().optional() })
      .parse(body);
    return this.library.renameCollection(user, id, patch);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.library.deleteCollection(user, id);
  }

  @Post(':id/items/:itemId')
  add(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.library.addToCollection(user, id, itemId);
  }

  @Delete(':id/items/:itemId')
  drop(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.library.removeFromCollection(user, id, itemId);
  }
}

@Module({
  controllers: [LibraryController, CollectionsController],
  providers: [LibraryService],
})
export class LibraryModule {}
