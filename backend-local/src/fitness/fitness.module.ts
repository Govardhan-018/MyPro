import { Module } from '@nestjs/common';
import { StravaClientService } from './strava-client.service';

/**
 * Training history (Phase 20.5). The tokens live on render; this is the
 * client that asks for the data.
 */
@Module({
  providers: [StravaClientService],
  exports: [StravaClientService],
})
export class FitnessModule {}
