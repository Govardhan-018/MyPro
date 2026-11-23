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

/**
 * Build a safe PostgREST `or(...)` filter matching a free-text query against
 * several columns with ILIKE.
 *
 * The query is embedded in PostgREST's comma-delimited `or=(…)` grammar, where
 * a comma separates conditions and parentheses group them — so a raw query like
 * `a, b (c)` silently split the filter into broken fragments instead of
 * searching for the text. Double-quoting the pattern makes those characters
 * literal; only the quote and backslash then need escaping. The `%`/`_` LIKE
 * wildcards are left as-is deliberately: they only ever widen a search.
 */
export function orIlike(query: string, columns: string[]): string {
  const pattern = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return columns.map((c) => `${c}.ilike."%${pattern}%"`).join(',');
}
