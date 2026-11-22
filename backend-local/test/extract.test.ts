import { describe, it, expect } from 'vitest';
import { extractArticle, pickDate } from '../src/research/extract';

/**
 * Phase 20 — HTML to citable text.
 *
 * Two things matter here. The text has to be the article and not the
 * navigation, because the model pays for every character it reads. And the
 * publication date has to be right or absent — a wrong date gets quoted back
 * to the user as fact, so "no date" is the correct answer more often than it
 * looks.
 */

const page = (body: string, head = '') =>
  `<!doctype html><html><head><title>Fallback title</title>${head}</head><body>${body}</body></html>`;

const NOW = Date.parse('2026-11-22T10:00:00Z');

describe('extractArticle', () => {
  it('prefers the article element and drops the furniture', () => {
    const html = page(`
      <nav><a href="/">Home</a><a href="/about">About this website today</a></nav>
      <header>A site-wide banner headline that is quite long</header>
      <article>
        <h1>The real headline</h1>
        <p>This is the first paragraph of the actual article and it is long enough to keep.</p>
        <p>This is the second paragraph, also comfortably long enough to be kept in full.</p>
      </article>
      <footer>Copyright some publisher, all rights reserved, every year</footer>
      <script>var tracking = 1;</script>`);

    const result = extractArticle(html, 'https://example.com/a', { maxChars: 5_000, now: NOW });

    expect(result.text).toContain('first paragraph of the actual article');
    expect(result.text).toContain('second paragraph');
    expect(result.text).toContain('## The real headline');
    expect(result.text).not.toContain('Home');
    expect(result.text).not.toContain('banner headline');
    expect(result.text).not.toContain('all rights reserved');
    expect(result.text).not.toContain('tracking');
  });

  it('takes the title from og:title, then <title>', () => {
    const withOg = extractArticle(
      page('<p>x</p>', '<meta property="og:title" content="Open Graph title">'),
      'https://example.com/a',
      { maxChars: 1_000, now: NOW },
    );
    expect(withOg.title).toBe('Open Graph title');

    const without = extractArticle(page('<p>x</p>'), 'https://example.com/a', {
      maxChars: 1_000,
      now: NOW,
    });
    expect(without.title).toBe('Fallback title');
  });

  it('takes the publisher from og:site_name, else the hostname', () => {
    expect(
      extractArticle(page('<p>x</p>', '<meta property="og:site_name" content="The Example">'), 'https://www.example.com/a', { maxChars: 500, now: NOW }).publisher,
    ).toBe('The Example');

    expect(
      extractArticle(page('<p>x</p>'), 'https://www.example.com/a', { maxChars: 500, now: NOW })
        .publisher,
    ).toBe('example.com');
  });

  it('reads the publication date from meta tags', () => {
    const result = extractArticle(
      page('<p>x</p>', '<meta property="article:published_time" content="2026-11-20T08:30:00Z">'),
      'https://example.com/a',
      { maxChars: 500, now: NOW },
    );
    expect(result.published_at).toBe('2026-11-20T08:30:00.000Z');
  });

  it('reads the publication date out of JSON-LD when there is no meta tag', () => {
    const result = extractArticle(
      page(
        '<p>x</p>',
        '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-11-19T06:00:00Z"}</script>',
      ),
      'https://example.com/a',
      { maxChars: 500, now: NOW },
    );
    expect(result.published_at).toBe('2026-11-19T06:00:00.000Z');
  });

  it('survives malformed JSON-LD, which is extremely common', () => {
    const result = extractArticle(
      page('<p>paragraph long enough to survive the filter here</p>', '<script type="application/ld+json">{not json</script>'),
      'https://example.com/a',
      { maxChars: 500, now: NOW },
    );
    expect(result.published_at).toBeUndefined();
    expect(result.text).toContain('paragraph long enough');
  });

  it('reports truncation rather than silently cutting', () => {
    const long = `<article><p>${'word '.repeat(400)}</p></article>`;
    const result = extractArticle(page(long), 'https://example.com/a', {
      maxChars: 200,
      now: NOW,
    });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(201 + 1);
  });

  it('does not repeat text from nested elements', () => {
    const html = page(`
      <article><div><p>A paragraph that appears once and must not be duplicated here.</p></div></article>`);
    const result = extractArticle(html, 'https://example.com/a', { maxChars: 5_000, now: NOW });
    const occurrences = result.text.split('appears once').length - 1;
    expect(occurrences).toBe(1);
  });

  it('returns empty text for a page with no prose rather than throwing', () => {
    const result = extractArticle(page('<div><img src="x.png"></div>'), 'https://example.com/a', {
      maxChars: 500,
      now: NOW,
    });
    expect(result.text).toBe('');
    expect(result.truncated).toBe(false);
  });

  it('handles a page with no body at all', () => {
    const result = extractArticle('<html></html>', 'https://example.com/a', {
      maxChars: 500,
      now: NOW,
    });
    expect(result.text).toBe('');
  });
});

describe('pickDate', () => {
  it('takes the first parseable candidate', () => {
    expect(pickDate([undefined, 'nonsense', '2026-11-20T08:30:00Z'], NOW)).toBe(
      '2026-11-20T08:30:00.000Z',
    );
  });

  it('drops a date far in the future — it would be cited as fact', () => {
    expect(pickDate(['2031-01-01T00:00:00Z'], NOW)).toBeUndefined();
  });

  it('drops an epoch-ish date', () => {
    expect(pickDate(['1970-01-01T00:00:00Z'], NOW)).toBeUndefined();
  });

  it('allows a date just inside the future tolerance (timezone skew)', () => {
    expect(pickDate(['2026-11-23T00:00:00Z'], NOW)).toBe('2026-11-23T00:00:00.000Z');
  });

  it('returns undefined when there is nothing usable', () => {
    expect(pickDate([undefined, '', 'tomorrow-ish'], NOW)).toBeUndefined();
  });
});
