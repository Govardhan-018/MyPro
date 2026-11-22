/**
 * robots.txt — a small, strict parser. Pure.
 *
 * We fetch pages a stranger wrote, so the polite thing and the safe thing
 * coincide: honour the site's own rules. This implements the parts of the
 * de-facto standard that matter for "may I fetch this one URL":
 *
 *   - group records by User-agent, longest-match wins on our UA
 *   - Allow / Disallow with `*` wildcards and `$` end-anchoring
 *   - longest matching rule wins; Allow wins a tie (the Google convention)
 *   - Crawl-delay, read but advisory
 *
 * Not implemented, deliberately: Sitemap, Host, and any non-standard
 * directive. An unparseable or missing robots.txt means "allowed", which is
 * the standard's own default — the alternative is a research tool that stops
 * working whenever a site ships a malformed file.
 */

export interface RobotsRule {
  /** Normalised path pattern, may contain `*` and a trailing `$`. */
  pattern: string;
  allow: boolean;
}

export interface RobotsPolicy {
  rules: RobotsRule[];
  /** Seconds the site asked us to wait between requests, if it said. */
  crawlDelay?: number;
}

/** The permissive policy: used for a missing, empty or unreadable file. */
export const ALLOW_ALL: RobotsPolicy = { rules: [] };

/**
 * Parse robots.txt for one user agent.
 *
 * Group selection follows the standard: collect the records whose
 * `User-agent` matches us most specifically, falling back to `*`.
 */
export function parseRobots(text: string, userAgent: string): RobotsPolicy {
  const ua = userAgent.toLowerCase();

  // agent token -> its rules, in file order
  const groups = new Map<string, RobotsRule[]>();
  const delays = new Map<string, number>();

  let currentAgents: string[] = [];
  let expectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group of rules.
      if (!expectingAgents) currentAgents = [];
      currentAgents.push(value.toLowerCase());
      expectingAgents = true;
      for (const agent of currentAgents) if (!groups.has(agent)) groups.set(agent, []);
      continue;
    }

    expectingAgents = false;
    if (!currentAgents.length) continue;

    if (field === 'allow' || field === 'disallow') {
      // "Disallow:" with an empty value means "nothing is disallowed".
      if (field === 'disallow' && value === '') continue;
      if (value === '') continue;
      for (const agent of currentAgents) {
        groups.get(agent)?.push({ pattern: value, allow: field === 'allow' });
      }
      continue;
    }

    if (field === 'crawl-delay') {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        for (const agent of currentAgents) delays.set(agent, seconds);
      }
    }
  }

  // Most specific matching agent token wins; '*' is the fallback.
  let chosen: string | undefined;
  for (const agent of groups.keys()) {
    if (agent === '*') continue;
    if (!ua.includes(agent)) continue;
    if (!chosen || agent.length > chosen.length) chosen = agent;
  }
  const key = chosen ?? (groups.has('*') ? '*' : undefined);
  if (!key) return ALLOW_ALL;

  return { rules: groups.get(key) ?? [], crawlDelay: delays.get(key) };
}

/** Does a robots pattern match this path? `*` is any run, `$` anchors the end. */
export function matchesPattern(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const source =
    body
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*') + (anchored ? '$' : '');

  try {
    return new RegExp(`^${source}`).test(path);
  } catch {
    // A pattern we cannot compile should not block the fetch.
    return false;
  }
}

/**
 * May we fetch this path?
 *
 * Longest matching pattern wins; on an equal-length tie Allow wins, which is
 * both the common convention and the safer reading of an ambiguous file.
 */
export function isAllowed(policy: RobotsPolicy, pathWithQuery: string): boolean {
  let best: RobotsRule | undefined;

  for (const rule of policy.rules) {
    if (!matchesPattern(rule.pattern, pathWithQuery)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule;
    }
  }

  return best ? best.allow : true;
}
