import {
  Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SupabaseService } from '../common/supabase.service';
import { AuditService } from '../common/audit.service';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { many, none, one } from '../common/crud';

/**
 * The OWNER's own access to their health data. The assistant does NOT use
 * these routes — it can only go through assistant_read_health() in the
 * database, which requires a live grant (see 0002_rls.sql).
 */

const createRecord = z.object({
  name: z.string().min(1).max(200),
  status: z.string().max(60).optional(),
  severity: z.string().max(60).optional(),
  started_on: z.string().date().optional(),
  ended_on: z.string().date().optional(),
  diagnosis: z.string().max(2000).optional(),
  doctor: z.string().max(200).optional(),
  consultation_on: z.string().date().optional(),
  notes: z.string().max(10_000).optional(),
});
const patchRecord = createRecord.partial();

const symptom = z.object({
  name: z.string().min(1).max(200),
  started_on: z.string().date().optional(),
  severity: z.string().max(60).optional(),
  notes: z.string().max(2000).optional(),
});
const medication = z.object({
  name: z.string().min(1).max(200),
  dosage: z.string().max(120).optional(),
  frequency: z.string().max(120).optional(),
  started_on: z.string().date().optional(),
  ended_on: z.string().date().optional(),
  reason: z.string().max(500).optional(),
  observations: z.string().max(2000).optional(),
});
const document = z.object({
  filename: z.string().min(1).max(300),
  kind: z.string().max(60).optional(),
  storage_path: z.string().max(500).optional(),
});

const SELECT = '*, health_symptoms(*), health_medications(*), health_documents(*)';

@Injectable()
export class HealthService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    return many(await db.from('health_records').select(SELECT).order('started_on', { ascending: false }));
  }

  async get(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return one(await db.from('health_records').select(SELECT).eq('id', id).maybeSingle());
  }

  async create(user: AuthUser, input: z.infer<typeof createRecord>) {
    const db = this.supabase.forUser(user.token);
    return one(
      await db.from('health_records').insert({ ...input, user_id: user.id }).select('*').single(),
    );
  }

  async update(user: AuthUser, id: string, input: z.infer<typeof patchRecord>) {
    const db = this.supabase.forUser(user.token);
    none(await db.from('health_records').update(input).eq('id', id));
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return none(await db.from('health_records').delete().eq('id', id));
  }

  async addChild(
    user: AuthUser,
    recordId: string,
    table: 'health_symptoms' | 'health_medications' | 'health_documents',
    row: Record<string, unknown>,
  ) {
    const db = this.supabase.forUser(user.token);
    return one(
      await db.from(table).insert({ ...row, health_record_id: recordId }).select('*').single(),
    );
  }

  async removeChild(
    user: AuthUser,
    table: 'health_symptoms' | 'health_medications' | 'health_documents',
    id: string,
  ) {
    const db = this.supabase.forUser(user.token);
    return none(await db.from(table).delete().eq('id', id));
  }

  // ---- assistant access grants ----
  async activeGrant(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    const res = await db
      .from('health_access_grants')
      .select('*')
      .eq('grantee', 'assistant')
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1);
    return many(res)[0] ?? null;
  }

  async grant(user: AuthUser, minutes: number, scope: 'read' | 'read_write') {
    const db = this.supabase.forUser(user.token);
    const expires = new Date(Date.now() + minutes * 60_000).toISOString();
    const created = one(
      await db
        .from('health_access_grants')
        .insert({ user_id: user.id, grantee: 'assistant', scope, expires_at: expires })
        .select('*')
        .single(),
    );
    await this.audit.record({
      userId: user.id,
      actor: 'user',
      action: 'health.grant.create',
      detail: { minutes, scope },
    });
    return created;
  }

  async revoke(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    none(
      await db
        .from('health_access_grants')
        .update({ revoked_at: new Date().toISOString() })
        .eq('grantee', 'assistant')
        .is('revoked_at', null),
    );
    await this.audit.record({ userId: user.id, actor: 'user', action: 'health.grant.revoke' });
    return { ok: true };
  }
}

@Controller('health/records')
@UseGuards(AuthGuard)
export class HealthRecordsController {
  constructor(private readonly health: HealthService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.health.list(u); }

  @Post() create(@CurrentUser() u: AuthUser, @Body() b: unknown) {
    return this.health.create(u, createRecord.parse(b));
  }

  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.health.get(u, id);
  }

  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: unknown) {
    return this.health.update(u, id, patchRecord.parse(b));
  }

  @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.health.remove(u, id);
  }

  @Post(':id/symptoms') addSymptom(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: unknown) {
    return this.health.addChild(u, id, 'health_symptoms', symptom.parse(b));
  }

  @Post(':id/medications') addMedication(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: unknown) {
    return this.health.addChild(u, id, 'health_medications', medication.parse(b));
  }

  @Post(':id/documents') addDocument(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: unknown) {
    return this.health.addChild(u, id, 'health_documents', document.parse(b));
  }
}

@Controller('health')
@UseGuards(AuthGuard)
export class HealthMetaController {
  constructor(private readonly health: HealthService) {}

  @Delete('symptoms/:id') dropSymptom(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.health.removeChild(u, 'health_symptoms', id);
  }

  @Delete('medications/:id') dropMedication(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.health.removeChild(u, 'health_medications', id);
  }

  @Delete('documents/:id') dropDocument(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.health.removeChild(u, 'health_documents', id);
  }

  /** Is the assistant currently allowed to read health data? */
  @Get('grant') grant(@CurrentUser() u: AuthUser) {
    return this.health.activeGrant(u);
  }

  /** Give the assistant time-boxed access. */
  @Post('grant') createGrant(@CurrentUser() u: AuthUser, @Body() b: unknown) {
    const { minutes, scope } = z
      .object({
        minutes: z.number().int().min(1).max(1440).default(60),
        scope: z.enum(['read', 'read_write']).default('read'),
      })
      .parse(b ?? {});
    return this.health.grant(u, minutes, scope);
  }

  @Delete('grant') revokeGrant(@CurrentUser() u: AuthUser) {
    return this.health.revoke(u);
  }
}

@Module({
  controllers: [HealthRecordsController, HealthMetaController],
  providers: [HealthService],
})
export class HealthRecordsModule {}
