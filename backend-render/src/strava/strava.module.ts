import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { InternalAuthGuard } from '../common/internal-auth.guard';
import { CryptoService } from '../common/crypto.service';
import { OAuthStateService } from '../common/oauth-state.service';
import { StravaService } from './strava.service';
import { env } from '../config/env';

const activitiesInput = z.object({
  user_id: z.string().uuid(),
  since_days: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(50).default(20),
});

@Controller('strava')
export class StravaController {
  constructor(private readonly strava: StravaService) {}

  /**
   * Strava's redirect lands here. **No AuthGuard**: this is a top-level
   * navigation from strava.com with no bearer token, and the signed `state`
   * is the authentication. Declared first so the guard never sees it.
   */
  @Get('callback')
  async callback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('scope') scope?: string,
    @Query('error') error?: string,
  ) {
    const appUrl = env().APP_URL ?? env().CORS_ORIGINS[0] ?? '/';
    const back = (params: string) => res.redirect(`${appUrl.replace(/\/$/, '')}/?${params}`);

    if (error) return back('strava=denied');
    if (!code || !state) return back('strava=error');

    try {
      await this.strava.handleCallback(code, state, scope);
      return back('strava=connected');
    } catch {
      return back('strava=error');
    }
  }

  @Get('status')
  @UseGuards(AuthGuard)
  status(@CurrentUser() user: AuthUser) {
    return this.strava.account(user);
  }

  @Post('connect')
  @UseGuards(AuthGuard)
  connect(@CurrentUser() user: AuthUser) {
    return this.strava.connectUrl(user);
  }

  @Delete('account')
  @UseGuards(AuthGuard)
  disconnect(@CurrentUser() user: AuthUser) {
    return this.strava.disconnect(user);
  }
}

/**
 * node→node. The laptop reads training history through here, because the
 * Strava tokens and the key that decrypts them live only on render.
 */
@Controller('internal/strava')
@UseGuards(InternalAuthGuard)
export class StravaInternalController {
  constructor(private readonly strava: StravaService) {}

  @Post('activities')
  activities(@Body() body: unknown) {
    const input = activitiesInput.parse(body);
    return this.strava.activities({
      userId: input.user_id,
      sinceDays: input.since_days,
      limit: input.limit,
    });
  }
}

@Module({
  controllers: [StravaController, StravaInternalController],
  providers: [StravaService, CryptoService, OAuthStateService, InternalAuthGuard],
})
export class StravaModule {}
