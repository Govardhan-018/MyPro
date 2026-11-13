import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * Loose shape of a PostgREST response. Deliberately `unknown` for `data`:
 * supabase-js infers row types from a generated Database type we do not use
 * yet, so we decouple the helper's generic from its inference.
 */
export interface PgLike {
  data: unknown;
  error: { message: string } | null;
}

/** Throws on a database error; 404s when a single row was expected but absent. */
export function one<T = unknown>(res: PgLike): T {
  if (res.error) throw new BadRequestException(res.error.message);
  if (res.data === null || res.data === undefined) throw new NotFoundException();
  return res.data as T;
}

/** Throws on a database error; an empty result is a valid empty list. */
export function many<T = unknown>(res: PgLike): T[] {
  if (res.error) throw new BadRequestException(res.error.message);
  return (res.data as T[] | null) ?? [];
}

/** Throws on a database error, returns nothing of interest. */
export function none(res: { error: { message: string } | null }): { ok: true } {
  if (res.error) throw new BadRequestException(res.error.message);
  return { ok: true };
}
