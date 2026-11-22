/**
 * SSRF protection — pure, so every rule is directly testable.
 *
 * The agent is about to fetch URLs that a *model* chose, from search results
 * written by *strangers*. This machine is a laptop on a home network with a
 * Supabase secret key in its environment and a Cloudflare tunnel pointing at
 * it. A URL resolving to 127.0.0.1, 192.168.1.1 or 169.254.169.254 must never
 * be fetched, and "it came from a search result" is not a reason to trust it.
 *
 * `http.service.ts` applies these checks to the original URL *and to every
 * redirect hop*, because a public hostname can 302 to a private address.
 */

/** Only these schemes are ever fetched. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export type UrlRejection =
  | 'not_a_url'
  | 'bad_scheme'
  | 'has_credentials'
  | 'no_host'
  | 'literal_private_ip'
  | 'blocked_host';

export interface UrlCheck {
  ok: boolean;
  url?: URL;
  reason?: UrlRejection;
}

/**
 * Hostnames that never resolve anywhere useful and are a common SSRF vector.
 * The real defence is the resolved-address check; this is a cheap first pass
 * that also catches the `*.localhost` suffix trick.
 */
const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

/** Suffixes that are reserved or route nowhere public. */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.onion'];

/** Parse and vet a URL before anything touches the network. */
export function checkUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'not_a_url' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return { ok: false, reason: 'bad_scheme' };
  // user:pass@host turns a fetch into an authenticated request we did not intend.
  if (url.username || url.password) return { ok: false, reason: 'has_credentials' };

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, reason: 'no_host' };
  if (BLOCKED_HOSTS.has(host)) return { ok: false, reason: 'blocked_host' };
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, reason: 'blocked_host' };
  }

  // A URL written as a literal address is checked here; a hostname is checked
  // after DNS resolution, which is the only place the truth lives.
  if (isIpLiteral(host) && isPrivateAddress(host)) {
    return { ok: false, reason: 'literal_private_ip' };
  }

  return { ok: true, url };
}

/** Does this host look like an IP literal rather than a name? */
export function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * Is this address one we must never fetch?
 *
 * Covers loopback, RFC1918 private space, link-local (including the cloud
 * metadata address), CGNAT, broadcast, multicast and the IPv6 equivalents,
 * plus IPv4-mapped IPv6 (`::ffff:10.0.0.1`), which is how a private address
 * sneaks past a v4-only check.
 */
export function isPrivateAddress(address: string): boolean {
  const addr = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!addr) return true;

  // IPv4-mapped and IPv4-compatible IPv6: fall through to the v4 rules.
  const mapped = addr.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateV4(mapped[1]);

  if (addr.includes(':')) return isPrivateV6(addr);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) return isPrivateV4(addr);

  // Not an address at all: refuse rather than guess.
  return true;
}

function isPrivateV4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 and 192.0.2.0/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast, reserved, broadcast

  return false;
}

function isPrivateV6(address: string): boolean {
  const addr = address.split('%')[0]; // strip a zone id
  if (addr === '::' || addr === '::1') return true; // unspecified, loopback

  const head = addr.replace(/^\[|\]$/g, '').split(':')[0] ?? '';
  const group = Number.parseInt(head || '0', 16);
  if (!Number.isFinite(group)) return true;

  if ((group & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((group & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((group & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  return false;
}
