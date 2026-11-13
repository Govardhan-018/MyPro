import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { env } from '../config/env';

/**
 * Guards node→node routes (`/internal/*`). These are never called by a
 * browser — only by the core node reaching the AI node. Uses a shared
 * secret compared in constant time.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-internal-token'];
    const expected = env().INTERNAL_SERVICE_TOKEN;

    if (typeof provided !== 'string' || provided.length !== expected.length) {
      throw new UnauthorizedException();
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
