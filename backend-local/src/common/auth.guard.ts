import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env';

export interface AuthUser {
  id: string;
  email?: string;
  /** The raw JWT, so services can build an RLS-scoped Supabase client. */
  token: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

/**
 * Supabase's current key system signs tokens asymmetrically, so we verify
 * against the project's published JWKS rather than a shared secret. jose
 * caches the key set and refreshes it on rotation by itself.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function keySet() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(env().SUPABASE_JWKS_URL));
  return jwks;
}

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice(7).trim();

    try {
      const { payload } = await jwtVerify(token, keySet(), {
        audience: 'authenticated',
      });
      if (!payload.sub) throw new Error('no subject');

      req.user = {
        id: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        token,
      };
      return true;
    } catch {
      // Deliberately opaque: never explain *why* a token failed.
      throw new UnauthorizedException('Invalid token');
    }
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw new UnauthorizedException();
    return req.user;
  },
);
