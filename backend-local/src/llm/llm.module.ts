import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';

/** One model provider for the whole agent. Swap the service to change vendor. */
@Global()
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
