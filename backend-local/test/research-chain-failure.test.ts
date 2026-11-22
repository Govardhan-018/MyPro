import { describe, it, expect, vi } from 'vitest';
import { ResearchService } from '../src/research/research.service';

/**
 * Phase 20 — what happens when every provider is down.
 *
 * From the first live run on Render: Wikipedia answered 429, the model read
 * "search failed" as something worth another go, and called `web_search`
 * four times in one turn. Every call was a fresh request to a service that
 * had already said no, each one burned a step of the turn's budget, and the
 * user watched four identical red cards appear.
 *
 * Retrying a rate limit is the one thing guaranteed not to clear it. So a
 * chain that fails completely is remembered as down for a few minutes, and
 * the error says so in words the model can act on.
 */

const cacheStub = () => ({
  key: (kind: string, parts: Record<string, unknown>) => `${kind}:${JSON.stringify(parts)}`,
  get: vi.fn(async () => null),
  put: vi.fn(async () => undefined),
  record: vi.fn(async () => undefined),
});

/** A registry whose single search provider always fails. */
const failingRegistry = (search: () => Promise<never>) => ({
  chain: () => [{ id: 'wikipedia' }],
  searchChain: () => [{ id: 'wikipedia', search }],
});

const serviceWith = (search: () => Promise<never>) => {
  const cache = cacheStub();
  const registry = failingRegistry(search);
  return {
    cache,
    service: new ResearchService(registry as never, cache as never),
  };
};

describe('a chain where everything fails', () => {
  it('reports which provider failed and why', async () => {
    const { service } = serviceWith(async () => {
      throw new Error('http_status: 429 from en.wikipedia.org');
    });

    await expect(service.search({ q: 'india cricket', limit: 3 })).rejects.toThrow(
      /Every search provider failed.*wikipedia.*429/s,
    );
  });

  it('does not call the provider again inside the memo window', async () => {
    const search = vi.fn(async () => {
      throw new Error('http_status: 429 from en.wikipedia.org');
    });
    const { service } = serviceWith(search as never);

    await expect(service.search({ q: 'india cricket', limit: 3 })).rejects.toThrow();
    // Same question, and three different ones: none of them should reach out.
    await expect(service.search({ q: 'india cricket', limit: 3 })).rejects.toThrow();
    await expect(service.search({ q: 'cricket news', limit: 3 })).rejects.toThrow();
    await expect(service.search({ q: 'something else', limit: 5 })).rejects.toThrow();

    expect(search).toHaveBeenCalledTimes(1);
  });

  it('tells the model not to retry, in words it can act on', async () => {
    const { service } = serviceWith(async () => {
      throw new Error('http_status: 429');
    });

    await expect(service.search({ q: 'x', limit: 3 })).rejects.toThrow(/Do not retry this turn/);
    await expect(service.search({ q: 'x', limit: 3 })).rejects.toThrow(/Do not retry this turn/);
  });

  it('keeps the reason in the second error, so the receipt still explains itself', async () => {
    const { service } = serviceWith(async () => {
      throw new Error('http_status: 429 from en.wikipedia.org');
    });

    await expect(service.search({ q: 'x', limit: 3 })).rejects.toThrow();
    await expect(service.search({ q: 'x', limit: 3 })).rejects.toThrow(/wikipedia/);
  });

  it('still serves a cached answer while the chain is down', async () => {
    const search = vi.fn(async () => {
      throw new Error('429');
    });
    const cache = cacheStub();
    const service = new ResearchService(failingRegistry(search as never) as never, cache as never);

    await expect(service.search({ q: 'x', limit: 3 })).rejects.toThrow();

    // A question answered earlier is still answerable: the providers being
    // unreachable says nothing about the validity of what we already have.
    cache.get = vi.fn(async () => ({ sources: [], provider: 'wikipedia', cached: false })) as never;
    const result = await service.search({ q: 'x', limit: 3 });

    expect(result.cached).toBe(true);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('refuses clearly when nothing is configured at all', async () => {
    const cache = cacheStub();
    const service = new ResearchService(
      { chain: () => [], searchChain: () => [] } as never,
      cache as never,
    );

    await expect(service.search({ q: 'x', limit: 3 })).rejects.toThrow(
      /No search provider is configured/,
    );
  });
});
