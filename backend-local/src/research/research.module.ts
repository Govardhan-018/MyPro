import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { ResearchHttpService } from './http.service';
import { ResearchCacheService } from './cache.service';
import { ProviderRegistry } from './provider.registry';
import { ResearchService } from './research.service';

/**
 * The research layer: the guarded fetcher, the provider chains, the cache.
 *
 * Exports only `ResearchService` — nothing outside this module may reach a
 * provider directly, which is what keeps vendor details inside
 * `research/providers/`. See docs/RESEARCH_PROVIDERS.md.
 */
@Module({
  imports: [CommonModule],
  providers: [ResearchHttpService, ResearchCacheService, ProviderRegistry, ResearchService],
  exports: [ResearchService],
})
export class ResearchModule {}
