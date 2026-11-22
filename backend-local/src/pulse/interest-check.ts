import { createHash } from 'node:crypto';

/**
 * Deciding whether a development is worth interrupting someone for. Pure.
 *
 * This is the part of interest monitoring that separates a companion from a
 * notification firehose. An RSS reader tells you everything; the judgement
 * here is "would they be glad I said this?", and the honest default is no.
 */

export interface Candidate {
  title: string;
  url?: string;
  publisher?: string;
  published_at?: string;
}

/**
 * A stable id for a story, so the same thing is never delivered twice.
 *
 * The URL is normalised first (host without `www`, no trailing slash, no
 * tracking parameters) because the same article arrives from two providers
 * with different query strings. With no URL the title is the identity.
 */
export function fingerprint(candidate: Candidate): string {
  let key = (candidate.title ?? '').trim().toLowerCase();

  if (candidate.url) {
    try {
      const url = new URL(candidate.url);
      for (const param of [...url.searchParams.keys()]) {
        if (/^(utm_|fbclid|gclid|ref|ref_src|igshid|amp)/i.test(param)) {
          url.searchParams.delete(param);
        }
      }
      key = `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`;
    } catch {
      key = candidate.url.trim().toLowerCase();
    }
  }

  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

/** Words that mark a development rather than routine coverage. */
const STRONG = [
  'wins', 'won', 'beat', 'defeat', 'record', 'signs', 'signed', 'announce', 'announced',
  'launch', 'launches', 'released', 'injury', 'injured', 'ruled out', 'retires', 'retired',
  'appointed', 'resigns', 'acquires', 'acquired', 'merger', 'raises', 'funding', 'lawsuit',
  'banned', 'suspended', 'final', 'champion', 'breaks', 'first ever', 'dies', 'death',
];
/** Words that mark speculation, listicles and SEO filler. */
const WEAK = [
  'could', 'might', 'rumour', 'rumor', 'reportedly', 'predicted', 'preview', 'opinion',
  'best ', 'top ', 'how to', 'why ', 'what to', 'live blog', 'highlights', 'quiz',
  'everything you need', 'fantasy', 'betting', 'odds', 'dream11',
];

/**
 * How much this looks like it matters, 0..1.
 *
 * Deliberately crude and deliberately free — no model call. It is a filter
 * ahead of the real gate (the interest's own threshold), and being roughly
 * right at zero cost beats being precisely right at the cost of a model call
 * per headline on every half-hourly tick.
 */
export function importanceOf(candidate: Candidate, now: number): number {
  const title = (candidate.title ?? '').toLowerCase();
  if (!title) return 0;

  let score = 0.4;
  if (STRONG.some((word) => title.includes(word))) score += 0.3;
  if (WEAK.some((word) => title.includes(word))) score -= 0.25;

  // Freshness: today is the news, last week is background.
  if (candidate.published_at) {
    const ageHours = (now - Date.parse(candidate.published_at)) / 3_600_000;
    if (Number.isFinite(ageHours)) {
      if (ageHours <= 12) score += 0.2;
      else if (ageHours <= 48) score += 0.1;
      else if (ageHours > 168) score -= 0.2;
    }
  } else {
    // An undated story cannot be shown to be new.
    score -= 0.1;
  }

  // A named publisher is weak evidence that this is not content farming.
  if (candidate.publisher) score += 0.05;

  return Math.max(0, Math.min(1, score));
}

/** Does this story actually mention the thing, or just share a word with it? */
export function mentions(candidate: Candidate, entity: string, aliases: string[]): boolean {
  const haystack = ` ${(candidate.title ?? '').toLowerCase()} `;
  return [entity, ...aliases]
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 1)
    .some((name) => haystack.includes(name));
}

/** Is this interest due a check? */
export function isDue(
  interest: { last_checked_at?: string | null; check_every_hours: number; active: boolean },
  now: number,
): boolean {
  if (!interest.active) return false;
  if (!interest.last_checked_at) return true;
  const since = now - Date.parse(interest.last_checked_at);
  return !Number.isFinite(since) || since >= interest.check_every_hours * 3_600_000;
}
