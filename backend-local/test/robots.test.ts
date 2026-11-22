import { describe, it, expect } from 'vitest';
import { ALLOW_ALL, isAllowed, matchesPattern, parseRobots } from '../src/research/robots';

/**
 * Phase 20 — robots.txt.
 *
 * Fetching pages a stranger wrote means honouring the site's own rules; the
 * polite thing and the safe thing coincide. The important property is the
 * failure direction: a missing or malformed file means *allowed*, because a
 * research tool that stops working whenever a site ships a broken robots.txt
 * is worse than useless.
 */

const UA = 'MyProBot/1.0 (personal assistant; respects robots.txt)';

describe('parseRobots + isAllowed', () => {
  it('allows everything when there are no rules', () => {
    expect(isAllowed(ALLOW_ALL, '/anything')).toBe(true);
    expect(isAllowed(parseRobots('', UA), '/anything')).toBe(true);
  });

  it('honours a blanket disallow for everyone', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /', UA);
    expect(isAllowed(policy, '/')).toBe(false);
    expect(isAllowed(policy, '/articles/1')).toBe(false);
  });

  it('honours a path disallow and leaves the rest alone', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /private/', UA);
    expect(isAllowed(policy, '/private/thing')).toBe(false);
    expect(isAllowed(policy, '/public/thing')).toBe(true);
  });

  it('lets a longer Allow override a shorter Disallow', () => {
    const policy = parseRobots(
      'User-agent: *\nDisallow: /articles/\nAllow: /articles/public/',
      UA,
    );
    expect(isAllowed(policy, '/articles/secret')).toBe(false);
    expect(isAllowed(policy, '/articles/public/one')).toBe(true);
  });

  it('treats an empty Disallow as "nothing is disallowed"', () => {
    const policy = parseRobots('User-agent: *\nDisallow:', UA);
    expect(isAllowed(policy, '/anything')).toBe(true);
  });

  it('prefers the group that names our agent over the wildcard', () => {
    const policy = parseRobots(
      ['User-agent: *', 'Disallow: /', '', 'User-agent: MyProBot', 'Disallow: /admin/'].join('\n'),
      UA,
    );
    expect(isAllowed(policy, '/articles/1')).toBe(true);
    expect(isAllowed(policy, '/admin/panel')).toBe(false);
  });

  it('shares one rule group between consecutive User-agent lines', () => {
    const policy = parseRobots(
      ['User-agent: SomeBot', 'User-agent: MyProBot', 'Disallow: /nope/'].join('\n'),
      UA,
    );
    expect(isAllowed(policy, '/nope/x')).toBe(false);
    expect(isAllowed(policy, '/yes/x')).toBe(true);
  });

  it('ignores comments and blank lines', () => {
    const policy = parseRobots(
      ['# a comment', 'User-agent: *   # trailing', '', 'Disallow: /x  # why'].join('\n'),
      UA,
    );
    expect(isAllowed(policy, '/x/1')).toBe(false);
  });

  it('reads Crawl-delay without letting it block anything', () => {
    const policy = parseRobots('User-agent: *\nCrawl-delay: 2.5', UA);
    expect(policy.crawlDelay).toBe(2.5);
    expect(isAllowed(policy, '/anything')).toBe(true);
  });

  it('ignores rules that belong to no group', () => {
    expect(isAllowed(parseRobots('Disallow: /', UA), '/anything')).toBe(true);
  });

  it('allows when the file is nonsense', () => {
    const policy = parseRobots('<<<!!! this is not robots.txt', UA);
    expect(isAllowed(policy, '/anything')).toBe(true);
  });
});

describe('matchesPattern', () => {
  it('matches a prefix', () => {
    expect(matchesPattern('/private', '/private/thing')).toBe(true);
    expect(matchesPattern('/private', '/public')).toBe(false);
  });

  it('expands * to any run of characters', () => {
    expect(matchesPattern('/*/edit', '/posts/edit')).toBe(true);
    expect(matchesPattern('/a*b', '/axxxb/c')).toBe(true);
  });

  it('anchors with $', () => {
    expect(matchesPattern('/page$', '/page')).toBe(true);
    expect(matchesPattern('/page$', '/page/sub')).toBe(false);
  });

  it('treats dots and question marks literally, not as regex', () => {
    expect(matchesPattern('/a.b', '/a.b')).toBe(true);
    expect(matchesPattern('/a.b', '/axb')).toBe(false);
    expect(matchesPattern('/search?q=', '/search?q=cats')).toBe(true);
  });
});
