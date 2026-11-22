import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { env } from '../config/env';
import { checkUrl, isIpLiteral, isPrivateAddress } from './net-guard';
import { ALLOW_ALL, isAllowed, parseRobots, type RobotsPolicy } from './robots';

/**
 * The only way research code reaches the network.
 *
 * Every rule that makes fetching a model-chosen URL survivable lives here:
 *
 *   - scheme, credential and hostname vetting (`net-guard.ts`)
 *   - DNS resolution, with **every** resolved address checked — one private
 *     answer among several is still a rebinding attack
 *   - redirects followed manually, re-vetted on each hop, hard-capped
 *   - a byte ceiling enforced while streaming, so a 2GB response cannot
 *     exhaust the laptop before Content-Length is believed
 *   - a wall-clock timeout per request
 *   - one request per host at a time, with a minimum gap between them
 *   - robots.txt honoured on page fetches (cached per host)
 *
 * Nothing here interprets the body. Everything it returns is untrusted data.
 */

export interface FetchOptions {
  method?: 'GET' | 'POST';
  /** JSON request body. Implies POST. */
  json?: unknown;
  /** Hard ceiling on the body we will read. */
  maxBytes?: number;
  timeoutMs?: number;
  /** Ask the site's robots.txt first. True for page fetches, false for APIs. */
  respectRobots?: boolean;
  /**
   * Minimum gap this host needs between requests, when it is stricter than
   * RESEARCH_HOST_DELAY_MS. GDELT, for one, demands one request every five
   * seconds and answers 429 with a slow body if you do not oblige.
   */
  minHostGapMs?: number;
  accept?: string;
  /** Query parameters, appended safely. */
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
}

export interface FetchResult {
  /** The URL that actually served the body, after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: string;
  /** True when the byte ceiling cut the body short. */
  truncated: boolean;
}

export class FetchRefused extends Error {
  constructor(
    readonly reason: string,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'FetchRefused';
  }
}

const MAX_REDIRECTS = 3;
const ROBOTS_TTL_MS = 6 * 3_600_000;
const ROBOTS_MAX_BYTES = 64 * 1_024;

@Injectable()
export class ResearchHttpService {
  private readonly logger = new Logger(ResearchHttpService.name);
  /** host → when its robots.txt was read, and what it said. */
  private readonly robots = new Map<string, { at: number; policy: RobotsPolicy }>();
  /** host → the promise chain serialising requests to it. */
  private readonly hostQueue = new Map<string, Promise<unknown>>();
  /** host → when we last finished a request there. */
  private readonly lastHit = new Map<string, number>();

  /**
   * The identity we present.
   *
   * Deliberately generic by default — it must never carry the user's name or
   * address. But several services (Wikimedia most visibly) throttle clients
   * they cannot identify, so `RESEARCH_USER_AGENT` exists for anyone willing
   * to put a contact in it. That is the user's call, not ours.
   */
  userAgent(): string {
    return (
      env().RESEARCH_USER_AGENT ||
      'MyProBot/1.0 (personal assistant; single user; respects robots.txt)'
    );
  }

  async fetchText(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
    const maxBytes = options.maxBytes ?? env().RESEARCH_MAX_FETCH_BYTES;
    const timeoutMs = options.timeoutMs ?? env().RESEARCH_FETCH_TIMEOUT_MS;

    const first = this.prepare(rawUrl, options.query);
    if (options.respectRobots) await this.assertRobotsAllows(first);

    // Serialise per host so a page with three links to the same site does not
    // arrive as three simultaneous requests.
    return this.perHost(
      first.hostname,
      () => this.follow(first, { ...options, maxBytes, timeoutMs }),
      options.minHostGapMs,
    );
  }

  /** Same guarantees, parsed. Throws `FetchRefused` on anything but JSON. */
  async fetchJson<T>(rawUrl: string, options: FetchOptions = {}): Promise<T> {
    const res = await this.fetchText(rawUrl, {
      accept: 'application/json',
      ...options,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new FetchRefused('http_status', `${res.status} from ${new URL(res.url).hostname}`);
    }
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new FetchRefused('bad_json', `${new URL(res.url).hostname} did not return JSON`);
    }
  }

  // ---- the guarded request ---------------------------------------------

  private prepare(rawUrl: string, query?: FetchOptions['query']): URL {
    const checked = checkUrl(rawUrl);
    if (!checked.ok || !checked.url) {
      throw new FetchRefused(checked.reason ?? 'not_a_url', `refused URL (${checked.reason})`);
    }
    const url = checked.url;
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  private async follow(start: URL, options: FetchOptions): Promise<FetchResult> {
    let url = start;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await this.assertPublic(url);

      const method = options.json ? 'POST' : (options.method ?? 'GET');
      const response = await fetch(url.toString(), {
        method,
        ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        headers: {
          'user-agent': this.userAgent(),
          accept: options.accept ?? 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'accept-language': 'en',
          ...(options.json === undefined ? {} : { 'content-type': 'application/json' }),
          ...options.headers,
        },
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        throw new FetchRefused(
          /abort|timeout/i.test(message) ? 'timeout' : 'network',
          `${url.hostname}: ${message}`,
        );
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new FetchRefused('bad_redirect', `${url.hostname} redirected nowhere`);
        if (hop === MAX_REDIRECTS) throw new FetchRefused('too_many_redirects');

        // Resolve relative, then put it through the same vetting as the
        // original: a public host may redirect to a private address.
        if (method === 'POST') {
          throw new FetchRefused('post_redirect', `${url.hostname} redirected a POST`);
        }
        const next = this.prepare(new URL(location, url).toString());
        this.logger.debug(`redirect ${url.hostname} → ${next.hostname}`);
        url = next;
        continue;
      }

      const { text, truncated } = await this.readCapped(response, options.maxBytes ?? 1_000_000);
      return {
        url: url.toString(),
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body: text,
        truncated,
      };
    }

    throw new FetchRefused('too_many_redirects');
  }

  /**
   * Read at most `maxBytes`, counting as we go.
   *
   * `Content-Length` is a claim, not a fact, so the ceiling is enforced on
   * the bytes that actually arrive — and the stream is cancelled the moment
   * it is reached.
   */
  private async readCapped(
    response: Response,
    maxBytes: number,
  ): Promise<{ text: string; truncated: boolean }> {
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes * 10) {
      void response.body?.cancel();
      throw new FetchRefused('too_large', `${Math.round(declared / 1_024)}KB declared`);
    }

    const reader = response.body?.getReader();
    if (!reader) return { text: '', truncated: false };

    const decoder = new TextDecoder('utf-8', { fatal: false });
    let out = '';
    let read = 0;
    let truncated = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      read += value.byteLength;
      if (read > maxBytes) {
        const keep = value.subarray(0, Math.max(0, value.byteLength - (read - maxBytes)));
        out += decoder.decode(keep);
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      out += decoder.decode(value, { stream: true });
    }

    return { text: out, truncated };
  }

  /** Resolve the host and refuse if *any* answer is a private address. */
  private async assertPublic(url: URL): Promise<void> {
    const host = url.hostname.replace(/^\[|\]$/g, '');

    if (isIpLiteral(host)) {
      if (isPrivateAddress(host)) throw new FetchRefused('private_address', host);
      return;
    }

    let addresses: { address: string }[];
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new FetchRefused('dns_failed', host);
    }

    if (!addresses.length) throw new FetchRefused('dns_failed', host);
    for (const { address } of addresses) {
      if (isPrivateAddress(address)) {
        throw new FetchRefused('private_address', `${host} → ${address}`);
      }
    }
  }

  // ---- politeness -------------------------------------------------------

  private async assertRobotsAllows(url: URL): Promise<void> {
    const policy = await this.policyFor(url);
    const path = `${url.pathname}${url.search}`;
    if (!isAllowed(policy, path)) {
      throw new FetchRefused('robots_disallow', `${url.hostname} disallows ${url.pathname}`);
    }
  }

  private async policyFor(url: URL): Promise<RobotsPolicy> {
    const host = url.host;
    const cached = this.robots.get(host);
    if (cached && Date.now() - cached.at < ROBOTS_TTL_MS) return cached.policy;

    let policy = ALLOW_ALL;
    try {
      const robotsUrl = new URL('/robots.txt', url.origin);
      await this.assertPublic(robotsUrl);
      const response = await fetch(robotsUrl.toString(), {
        redirect: 'follow',
        signal: AbortSignal.timeout(5_000),
        headers: { 'user-agent': this.userAgent(), accept: 'text/plain' },
      });
      if (response.ok) {
        const { text } = await this.readCapped(response, ROBOTS_MAX_BYTES);
        policy = parseRobots(text, this.userAgent());
      } else {
        void response.body?.cancel();
      }
    } catch {
      // No robots.txt, or it would not load: the standard's default is allow.
      policy = ALLOW_ALL;
    }

    this.robots.set(host, { at: Date.now(), policy });
    return policy;
  }

  /** One request per host at a time, with a minimum gap between them. */
  private perHost<T>(host: string, run: () => Promise<T>, minGapMs?: number): Promise<T> {
    const gap = Math.max(env().RESEARCH_HOST_DELAY_MS, minGapMs ?? 0);
    const previous = this.hostQueue.get(host) ?? Promise.resolve();

    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const since = Date.now() - (this.lastHit.get(host) ?? 0);
        if (since < gap) await new Promise((resolve) => setTimeout(resolve, gap - since));
        try {
          return await run();
        } finally {
          this.lastHit.set(host, Date.now());
        }
      });

    this.hostQueue.set(
      host,
      next.catch(() => undefined),
    );
    return next;
  }
}
