import { describe, it, expect } from 'vitest';
import { parseFeed } from '../src/research/providers/rss.provider';

/**
 * Phase 20 — the RSS reader.
 *
 * Hand-rolled rather than a dependency: feeds are a fixed, simple shape, and
 * an XML library parsing untrusted input brings a larger attack surface
 * (entity expansion, external entities) than the problem deserves. The cost
 * of that choice is that the parser needs real tests, so here they are —
 * including the two shapes that actually differ in the wild, RSS 2.0 and
 * Atom.
 */

const FETCHED = '2026-11-22T10:00:00.000Z';
const parse = (xml: string) => parseFeed(xml, FETCHED, 'rss');

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example feed</title>
  <item>
    <title>India win the series</title>
    <link>https://www.example.com/sport/india-win</link>
    <description>&lt;p&gt;A chase for the ages.&lt;/p&gt;</description>
    <pubDate>Fri, 20 Nov 2026 18:24:12 GMT</pubDate>
  </item>
  <item>
    <title><![CDATA[Markets & bonds rally]]></title>
    <link>https://www.example.com/business/markets</link>
    <pubDate>Thu, 19 Nov 2026 09:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>A new release</title>
    <link rel="alternate" href="https://blog.example.org/release"/>
    <updated>2026-11-21T12:00:00Z</updated>
    <summary>Shipped today.</summary>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('reads RSS 2.0 items', () => {
    const items = parse(RSS);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('India win the series');
    expect(items[0].url).toBe('https://www.example.com/sport/india-win');
    expect(items[0].published_at).toBe('2026-11-20T18:24:12.000Z');
  });

  it('reads Atom entries, whose link is an attribute', () => {
    const items = parse(ATOM);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://blog.example.org/release');
    expect(items[0].published_at).toBe('2026-11-21T12:00:00.000Z');
    expect(items[0].snippet).toBe('Shipped today.');
  });

  it('unwraps CDATA and decodes entities', () => {
    expect(parse(RSS)[1].title).toBe('Markets & bonds rally');
  });

  it('strips markup out of a description', () => {
    expect(parse(RSS)[0].snippet).toBe('A chase for the ages.');
  });

  it('names the publisher from the host, without www', () => {
    expect(parse(RSS)[0].publisher).toBe('example.com');
  });

  it('stamps every item with when we fetched it', () => {
    for (const item of parse(RSS)) expect(item.fetched_at).toBe(FETCHED);
  });

  it('skips an item with no title or no link rather than inventing one', () => {
    const items = parse(
      `<rss><channel>
        <item><title>No link here</title></item>
        <item><link>https://example.com/no-title</link></item>
        <item><title>Good</title><link>https://example.com/good</link></item>
      </channel></rss>`,
    );
    expect(items.map((i) => i.title)).toEqual(['Good']);
  });

  it('leaves the date absent when it cannot be parsed', () => {
    const items = parse(
      `<rss><channel><item><title>T</title><link>https://example.com/a</link>
        <pubDate>last Tuesday-ish</pubDate></item></channel></rss>`,
    );
    expect(items[0].published_at).toBeUndefined();
  });

  it('returns nothing for junk instead of throwing', () => {
    expect(parse('<html><body>not a feed</body></html>')).toEqual([]);
    expect(parse('')).toEqual([]);
  });
});
