import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { AuditService } from './audit.service';
import { AuthGuard } from './auth.guard';
import { HealthController } from './health.controller';
import { KeepAliveController } from './keepalive.controller';

@Global()
@Module({
  controllers: [HealthController, KeepAliveController],
  providers: [SupabaseService, AuditService, AuthGuard],
  exports: [SupabaseService, AuditService, AuthGuard],
})
export class CommonModule {}
