import { describe, it, expect } from 'vitest';
import { checkUrl, isIpLiteral, isPrivateAddress } from '../src/research/net-guard';

/**
 * Phase 20 — SSRF protection.
 *
 * The agent fetches URLs a *model* chose out of search results a *stranger*
 * wrote, on a laptop that holds a Supabase secret key and sits behind a
 * tunnel. These are the rules that make that survivable, so every one of them
 * gets a test naming the thing it prevents.
 */

describe('isPrivateAddress', () => {
  it('blocks loopback', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });

  it('blocks RFC1918 private space', () => {
    for (const a of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });

  it('blocks the cloud metadata address', () => {
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
  });

  it('blocks CGNAT, broadcast, multicast and 0.0.0.0', () => {
    for (const a of ['100.64.0.1', '255.255.255.255', '224.0.0.1', '0.0.0.0']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });

  it('blocks IPv4-mapped IPv6 — the way a private address sneaks past', () => {
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:192.168.0.1')).toBe(true);
    // ...and still allows a mapped public address
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('blocks IPv6 unique-local, link-local and multicast', () => {
    for (const a of ['fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const a of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
  });

  it('refuses anything that is not an address at all', () => {
    for (const a of ['', 'not-an-ip', '999.1.1.1', '10.0.0']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });
});

describe('isIpLiteral', () => {
  it('tells an address from a hostname', () => {
    expect(isIpLiteral('93.184.216.34')).toBe(true);
    expect(isIpLiteral('fe80::1')).toBe(true);
    expect(isIpLiteral('example.com')).toBe(false);
  });
});

describe('checkUrl', () => {
  it('accepts a plain https URL', () => {
    const result = checkUrl('https://example.com/article?id=2');
    expect(result.ok).toBe(true);
    expect(result.url?.hostname).toBe('example.com');
  });

  it('rejects non-http schemes', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com',
      'gopher://example.com',
      'data:text/html,hi',
      'javascript:alert(1)',
    ]) {
      expect(checkUrl(url).reason, url).toBe('bad_scheme');
    }
  });

  it('rejects embedded credentials', () => {
    expect(checkUrl('https://user:pass@example.com/').reason).toBe('has_credentials');
  });

  it('rejects localhost by name, including the suffix trick', () => {
    expect(checkUrl('http://localhost:8787/api').reason).toBe('blocked_host');
    expect(checkUrl('http://anything.localhost/').reason).toBe('blocked_host');
    expect(checkUrl('http://supabase.internal/').reason).toBe('blocked_host');
  });

  it('rejects the cloud metadata host by name', () => {
    expect(checkUrl('http://metadata.google.internal/computeMetadata/').reason).toBe(
      'blocked_host',
    );
  });

  it('rejects a literal private address', () => {
    expect(checkUrl('http://192.168.0.1/admin').reason).toBe('literal_private_ip');
    expect(checkUrl('http://[::1]:8787/').reason).toBe('literal_private_ip');
  });

  it('rejects junk', () => {
    expect(checkUrl('not a url').reason).toBe('not_a_url');
    expect(checkUrl('https://').reason).toBe('not_a_url');
  });

  it('allows a public literal address', () => {
    expect(checkUrl('http://93.184.216.34/').ok).toBe(true);
  });
});
