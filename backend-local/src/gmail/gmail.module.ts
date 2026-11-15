import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { RenderMailService } from './render-mail.service';
import { EmailInsightsService } from './email-insights.service';

/**
 * The laptop's half of Gmail (Phase 7).
 *
 * It summarises (7.5), because the model is here, and it asks render to send
 * (7.6), because the tokens are there. It never holds a Gmail credential.
 */
@Module({
  imports: [LlmModule],
  providers: [RenderMailService, EmailInsightsService],
  exports: [RenderMailService],
})
export class LocalGmailModule {}
