import { Controller, Get } from '@nestjs/common';

/**
 * Liveness probe only. Unauthenticated by design, so it must never
 * reveal versions, config, dependency state or user data.
 */
@Controller('healthz')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
