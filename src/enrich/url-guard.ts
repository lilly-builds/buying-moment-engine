import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

/**
 * SSRF guard for the scraper (COV-04).
 *
 * The engine fetches `websiteUrl`s sourced from the DB and follows redirects. Without
 * this guard, a URL (or a redirect hop) that points at cloud metadata
 * (169.254.169.254), loopback, or a private range makes the server fetch internal
 * endpoints. Every outbound scrape fetch goes through `guardedFetch`, which validates
 * the initial URL and re-validates every redirect hop BEFORE the request is made.
 *
 * The IP-range classification (`isBlockedAddress`) is pure and exhaustively tested;
 * DNS resolution is injected so the guard can resolve a hostname to its addresses
 * (defence against a DB hostname whose A-record points inside) while unit tests stay
 * hermetic.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** Resolves a hostname to its IP addresses (all of them). */
export type DnsLookupAll = (hostname: string) => Promise<string[]>;

export interface UrlGuardOptions {
  /** When supplied, DNS names are resolved and every address is range-checked. */
  lookup?: DnsLookupAll;
}

// ── IPv4 ────────────────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = (n << 8) | octet;
  }
  return n >>> 0;
}

/** base CIDR blocks that must never be fetched (private, loopback, link-local, reserved). */
const V4_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network" / unspecified
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT (RFC 6598)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. 169.254.169.254 cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
  ["255.255.255.255", 32], // broadcast
];

function isBlockedV4Int(n: number): boolean {
  return V4_BLOCKS.some(([base, bits]) => {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (baseInt & mask);
  });
}

// ── IPv6 ────────────────────────────────────────────────────────────────────

/** Parse an IPv6 literal (incl. embedded IPv4) into its 16 bytes, or null. */
function parseIPv6(input: string): number[] | null {
  let ip = input.split("%")[0].toLowerCase(); // strip any zone id

  // Fold a trailing embedded IPv4 (e.g. ::ffff:127.0.0.1) into two hextets.
  if (ip.includes(".")) {
    const colonIdx = ip.lastIndexOf(":");
    if (colonIdx === -1) return null;
    const v4int = ipv4ToInt(ip.slice(colonIdx + 1));
    if (v4int === null) return null;
    const hi = ((v4int >>> 16) & 0xffff).toString(16);
    const lo = (v4int & 0xffff).toString(16);
    ip = `${ip.slice(0, colonIdx + 1)}${hi}:${lo}`;
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;

  const toHextets = (segment: string): number[] | null => {
    if (segment === "") return [];
    const out: number[] = [];
    for (const group of segment.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  const head = toHextets(halves[0]);
  const tail = halves.length === 2 ? toHextets(halves[1]) : [];
  if (head === null || tail === null) return null;

  let hextets: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    hextets = [...head, ...Array(missing).fill(0), ...tail];
  } else {
    hextets = head;
  }
  if (hextets.length !== 8) return null;

  const bytes: number[] = [];
  for (const h of hextets) bytes.push((h >>> 8) & 0xff, h & 0xff);
  return bytes;
}

function isBlockedIPv6(bytes: number[]): boolean {
  if (bytes.every((b) => b === 0)) return true; // ::  unspecified
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true; // ::1 loopback
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  // ::ffff:0:0/96 IPv4-mapped → classify the embedded IPv4.
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    const v4 = ((bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15]) >>> 0;
    return isBlockedV4Int(v4);
  }
  return false;
}

/**
 * True if `ip` (an IPv4 or IPv6 literal) is in a range we must never fetch. A string
 * that is not an IP literal returns false — hostname policy is handled by the URL guard.
 */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return n === null ? true : isBlockedV4Int(n);
  }
  if (kind === 6) {
    const bytes = parseIPv6(ip);
    return bytes === null ? true : isBlockedIPv6(bytes);
  }
  return false;
}

// ── URL / host policy ─────────────────────────────────────────────────────────

function hostOf(url: URL): string {
  const h = url.hostname;
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (isIP(h) !== 0) return isBlockedAddress(h);
  return false;
}

/**
 * Throws `BlockedUrlError` if `rawUrl` must not be fetched: non-http(s) scheme, a
 * literal internal address, `localhost`, or (when `lookup` is given) a hostname that
 * resolves to an internal address. Returns normally for a safe URL.
 */
export async function assertFetchableUrl(rawUrl: string, opts: UrlGuardOptions = {}): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError(`unparseable URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(`disallowed scheme "${url.protocol}" in ${rawUrl}`);
  }

  const host = hostOf(url);
  if (isBlockedHostname(host)) {
    throw new BlockedUrlError(`blocked host "${host}" in ${rawUrl}`);
  }

  // A DNS name may still point inside. Resolve and range-check every address.
  if (isIP(host) === 0 && opts.lookup) {
    let addresses: string[];
    try {
      addresses = await opts.lookup(host);
    } catch {
      // Fail CLOSED: if a resolver is configured but cannot verify the host is public,
      // refuse rather than fetch an unverifiable target. A genuine DNS failure would fail
      // the real fetch anyway, so this costs no availability while closing a fail-open gap.
      throw new BlockedUrlError(`could not resolve host "${host}" to verify it is public`);
    }
    for (const address of addresses) {
      if (isBlockedAddress(address)) {
        throw new BlockedUrlError(`host "${host}" resolves to blocked address ${address}`);
      }
    }
  }
}

// ── Guarded fetch (validates every redirect hop) ───────────────────────────────

export const MAX_REDIRECTS = 5;

export interface GuardedFetchResult {
  response: Response;
  /** The URL the returned bytes actually came from (end of the redirect chain). */
  finalUrl: string;
}

/**
 * `fetch`, but every URL in the redirect chain is validated before it is requested.
 * Redirects are followed manually (`redirect: "manual"`) so a hop to an internal
 * address is refused BEFORE the request is made, not merely discarded afterward.
 */
export async function guardedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  opts: UrlGuardOptions = {},
): Promise<GuardedFetchResult> {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertFetchableUrl(currentUrl, opts);
    const response = await fetchImpl(currentUrl, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    return { response, finalUrl: response.url || currentUrl };
  }
  throw new BlockedUrlError(`too many redirects starting from ${url}`);
}

/** Production DNS resolver: every A/AAAA record for a host. */
export const dnsLookupAll: DnsLookupAll = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((r) => r.address);
};
