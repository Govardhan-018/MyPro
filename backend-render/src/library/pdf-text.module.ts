import {
  BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException,
  Param, Post, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SupabaseService } from '../common/supabase.service';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { env } from '../config/env';
import { none } from '../common/crud';

/**
 * Extracted PDF text (Roadmap Phase 10.2).
 *
 * The raw PDF never leaves the device that holds it. The device that *can*
 * read it (today: the web app, via pdfjs) extracts structured JSON and parks
 * it in Supabase Storage; every other client — Android especially — just
 * downloads that JSON.
 *
 * Clients hold no Supabase credentials (thin-client model), so this module
 * brokers short-lived signed URLs and the client streams the JSON straight to
 * Storage. That also keeps multi-megabyte bodies off Render, whose JSON body
 * limit is 1 MB.
 */
const BUCKET = 'pdf-text';

const SIGNED_DOWNLOAD_TTL_SECONDS = 300;

const confirmInput = z.object({
  path: z.string().min(1).max(500),
  page_count: z.number().int().positive(),
  scanned: z.boolean().optional(),
});

@Injectable()
export class PdfTextService {
  constructor(private readonly supabase: SupabaseService) {}

  /** One object per library item, inside the owner's folder. */
  private objectPath(user: AuthUser, itemId: string): string {
    return `${user.id}/${itemId}.json`;
  }

  /** supabase-js may hand back a storage-relative URL; make it absolute. */
  private absolute(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    const base = env().SUPABASE_URL.replace(/\/+$/, '');
    return `${base}/storage/v1${url.startsWith('/') ? '' : '/'}${url}`;
  }

  /** RLS already scopes this; a miss means "not yours" as much as "gone". */
  private async assertBook(user: AuthUser, itemId: string): Promise<void> {
    const db = this.supabase.forUser(user.token);
    const res = await db
      .from('library_items')
      .select('id, type')
      .eq('id', itemId)
      .maybeSingle();
    if (res.error) throw new BadRequestException(res.error.message);
    if (!res.data) throw new NotFoundException();
  }

  private async storedPath(user: AuthUser, itemId: string): Promise<string | null> {
    const db = this.supabase.forUser(user.token);
    const res = await db
      .from('book_details')
      .select('pdf_json_path')
      .eq('library_item_id', itemId)
      .maybeSingle();
    if (res.error) throw new BadRequestException(res.error.message);
    const row = res.data as { pdf_json_path: string | null } | null;
    return row?.pdf_json_path ?? null;
  }

  /** A one-shot URL the client can PUT the extracted JSON to. */
  async uploadUrl(user: AuthUser, itemId: string) {
    await this.assertBook(user, itemId);
    const path = this.objectPath(user, itemId);
    const storage = this.supabase.forUser(user.token).storage.from(BUCKET);

    // Re-extraction replaces the previous JSON; a stale object would otherwise
    // make the signed upload 409. The client also sends `x-upsert: true`.
    await storage.remove([path]).catch(() => undefined);

    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) {
      throw new BadRequestException(error?.message ?? 'Could not sign the upload');
    }
    return { url: this.absolute(data.signedUrl), path };
  }

  /** A short-lived URL to read the JSON, or nulls when nothing is stored. */
  async downloadUrl(user: AuthUser, itemId: string) {
    await this.assertBook(user, itemId);
    const path = (await this.storedPath(user, itemId)) ?? this.objectPath(user, itemId);
    const storage = this.supabase.forUser(user.token).storage.from(BUCKET);
    const { data, error } = await storage.createSignedUrl(path, SIGNED_DOWNLOAD_TTL_SECONDS);
    // "not found" is the normal case for a book nobody has extracted yet.
    if (error || !data) return { url: null, path: null };
    return { url: this.absolute(data.signedUrl), path };
  }

  /** Record the upload against the book so other devices know it exists. */
  async confirm(user: AuthUser, itemId: string, input: z.infer<typeof confirmInput>) {
    await this.assertBook(user, itemId);
    const db = this.supabase.forUser(user.token);
    return none(
      await db.from('book_details').upsert(
        {
          library_item_id: itemId,
          pdf_json_path: input.path,
          total_pages: input.page_count,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'library_item_id' },
      ),
    );
  }
}

@Controller('library/:itemId/pdf-text')
@UseGuards(AuthGuard)
export class PdfTextController {
  constructor(private readonly pdfText: PdfTextService) {}

  @Post('upload-url')
  uploadUrl(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.pdfText.uploadUrl(user, itemId);
  }

  @Get('url')
  downloadUrl(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.pdfText.downloadUrl(user, itemId);
  }

  @Post('confirm')
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.pdfText.confirm(user, itemId, confirmInput.parse(body));
  }
}

@Module({
  controllers: [PdfTextController],
  providers: [PdfTextService],
})
export class PdfTextModule {}
