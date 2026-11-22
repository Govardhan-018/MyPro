import * as cheerio from 'cheerio';

/**
 * HTML → clean text, with the metadata a citation needs.
 *
 * Readability-style, but on Cheerio alone: no jsdom, no headless browser.
 * That is a deliberate constraint — the target is a laptop and, eventually,
 * Render Free, and a browser engine is both too heavy and too slow to be
 * worth it for the one job we have, which is "turn an article into the few
 * thousand characters the model should read".
 *
 * Pure: HTML in, text out. No network, no clock (the caller passes `now` so
 * date sanity checks are testable).
 */

export interface Extracted {
  title?: string;
  publisher?: string;
  /** ISO-8601, and only when it survived the sanity check. */
  published_at?: string;
  /** Plain text, blocks separated by blank lines. */
  text: string;
  truncated: boolean;
}

/** Anything that is never article content. */
const STRIP = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'form',
  'nav',
  'header',
  'footer',
  'aside',
  'button',
  '[aria-hidden="true"]',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="complementary"]',
  '.advertisement',
  '.ad',
  '.ads',
  '.cookie',
  '.newsletter',
  '.related',
  '.share',
  '.social',
  '.comments',
  '#comments',
].join(',');

/** Where an article usually lives, best first. */
const CANDIDATES = [
  'article',
  '[itemprop="articleBody"]',
  'main',
  '[role="main"]',
  '.article-body',
  '.post-content',
  '.entry-content',
  '.story-body',
  '#content',
  '.content',
  'body',
];

/** Lines shorter than this are navigation furniture, not prose. */
const MIN_LINE_CHARS = 25;
/** A line with no sentence punctuation and few words is a label. */
const MIN_LINE_WORDS = 4;

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function extractArticle(
  html: string,
  url: string,
  options: { maxChars: number; now?: number },
): Extracted {
  const $ = cheerio.load(html);
  const meta = (selector: string): string | undefined => {
    const value = $(selector).attr('content');
    const text = value ? squash(value) : '';
    return text || undefined;
  };

  const title =
    meta('meta[property="og:title"]') ??
    meta('meta[name="twitter:title"]') ??
    (squash($('title').first().text()) || undefined) ??
    (squash($('h1').first().text()) || undefined);

  const publisher =
    meta('meta[property="og:site_name"]') ??
    meta('meta[name="application-name"]') ??
    hostOf(url);

  const published = pickDate(
    [
      meta('meta[property="article:published_time"]'),
      meta('meta[property="og:published_time"]'),
      meta('meta[name="article:published_time"]'),
      meta('meta[itemprop="datePublished"]'),
      meta('meta[name="date"]'),
      meta('meta[name="pubdate"]'),
      meta('meta[name="DC.date.issued"]'),
      $('time[datetime]').first().attr('datetime'),
      jsonLdDate($),
    ],
    options.now ?? Date.now(),
  );

  // Strip the furniture before measuring anything, so a nav-heavy page does
  // not win the container contest on sheer volume.
  $(STRIP).remove();

  let best = { score: -1, text: '' };
  for (const selector of CANDIDATES) {
    const node = $(selector).first();
    if (!node.length) continue;
    const text = blocksOf($, node);
    const score = text.length + node.find('p').length * 120;
    if (score > best.score) best = { score, text };
    // An <article> with real prose is authoritative; stop looking.
    if (selector === 'article' && text.length > 400) break;
  }

  const full = best.text;
  const truncated = full.length > options.maxChars;

  return {
    title,
    publisher,
    published_at: published,
    text: truncated ? `${full.slice(0, options.maxChars).trimEnd()}…` : full,
    truncated,
  };
}

/** Block-level text, one paragraph per line, furniture dropped. */
function blocksOf($: cheerio.CheerioAPI, root: ReturnType<cheerio.CheerioAPI>): string {
  const lines: string[] = [];
  const seen = new Set<string>();

  root.find('h1,h2,h3,h4,p,li,blockquote,pre,dd,figcaption').each((_, el) => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? '';
    const text = squash($(el).text());
    if (!text) return;

    const words = text.split(' ').length;
    const heading = /^h[1-4]$/.test(tag);

    // Headings are kept short; prose is not.
    if (!heading && text.length < MIN_LINE_CHARS) return;
    if (!heading && words < MIN_LINE_WORDS && !/[.!?]/.test(text)) return;

    // Nested elements repeat their parents' text; keep the first occurrence.
    const key = text.slice(0, 120);
    if (seen.has(key)) return;
    seen.add(key);

    lines.push(heading ? `## ${text}` : text);
  });

  return lines.join('\n\n');
}

/** The first date that parses and is not obviously wrong. */
export function pickDate(
  candidates: (string | undefined)[],
  now: number,
): string | undefined {
  // A publication date in 1970 or three years from now is worse than none:
  // it would be cited as fact.
  const floor = Date.parse('1995-01-01T00:00:00Z');
  const ceiling = now + 2 * 86_400_000;

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = Date.parse(candidate.trim());
    if (!Number.isFinite(parsed)) continue;
    if (parsed < floor || parsed > ceiling) continue;
    return new Date(parsed).toISOString();
  }
  return undefined;
}

/** `datePublished` out of any JSON-LD block on the page. */
function jsonLdDate($: cheerio.CheerioAPI): string | undefined {
  let found: string | undefined;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      found = findKey(JSON.parse(raw), 'datePublished');
    } catch {
      // Malformed JSON-LD is extremely common. Ignore it.
    }
  });

  return found;
}

/** First string value for `key`, searched breadth-first. Depth-capped. */
function findKey(value: unknown, key: string, depth = 0): string | undefined {
  if (depth > 5 || value == null || typeof value !== 'object') return undefined;

  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findKey(item, key, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  for (const nested of Object.values(record)) {
    const hit = findKey(nested, key, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}
