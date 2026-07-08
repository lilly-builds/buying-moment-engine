/**
 * A minimal `robots.txt` policy for the `User-agent: *` group.
 *
 * WHY THIS EXISTS AT ALL (D9, M6): the scraper reads public, unauthenticated
 * pages, so `robots.txt` is convention rather than law and honoring it is a
 * choice. It was measured, not assumed — 0 of the 10 cohort domains disallow any
 * path we crawl, and an honest self-identifying User-Agent still gets 10/10
 * homepages (E4). The recall cost of the clean option is ZERO, so we take it: a
 * public repo whose entire thesis is "every claim is cited and ToS-clean" cannot
 * have a scraper that ignores the one file the site uses to say no.
 *
 * Pure: no network, no I/O. `scrape.ts` fetches the file; this decides.
 *
 * DELIBERATELY NOT IMPLEMENTED — `Allow:` directives, `*` wildcards, and `$`
 * anchors. The spec's longest-match Allow-beats-Disallow rule would only ever
 * make us crawl MORE. Ignoring it can only make us skip a page we were permitted
 * to read, which degrades to escalation, never to a violation. Failing toward
 * "don't fetch" is the correct direction for the only asymmetry that matters
 * here. If a real site ever costs us an escalation this way, U8's escalation-rate
 * number will show it.
 */

export interface RobotsPolicy {
  /** Path prefixes the `User-agent: *` group forbids. Empty = crawl anything. */
  disallow: string[];
}

/** Nothing forbidden. Also what a missing or unfetchable `robots.txt` means. */
export const ALLOW_ALL: RobotsPolicy = { disallow: [] };

/**
 * Resolve the `User-agent: *` group's `Disallow` prefixes.
 *
 * A group is one or more consecutive `User-agent` lines followed by its rules, so
 * a new `User-agent` line AFTER a rule line starts a new group. `User-agent: a`
 * immediately followed by `User-agent: *` is ONE group addressing both.
 */
export function parseRobotsTxt(text: string): RobotsPolicy {
  const disallow: string[] = [];
  let inStarGroup = false;
  let sawRuleInGroup = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const hash = rawLine.indexOf("#");
    const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim();
    if (line === "") continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (sawRuleInGroup) {
        inStarGroup = false;
        sawRuleInGroup = false;
      }
      if (value === "*") inStarGroup = true;
      continue;
    }

    sawRuleInGroup = true;
    // A bare `Disallow:` means "nothing is disallowed" — it must NOT become the
    // empty prefix, which `startsWith` would match against every path on earth.
    if (field === "disallow" && inStarGroup && value !== "") {
      disallow.push(value);
    }
  }

  return { disallow };
}

/**
 * `null` policy = no `robots.txt` we could read = allowed (the convention).
 * Matching is a plain prefix test, per the spec: `Disallow: /wp-admin` forbids
 * `/wp-administrator` too. Query strings and fragments are not part of the match.
 */
export function isAllowed(policy: RobotsPolicy | null, path: string): boolean {
  if (!policy) return true;
  if (policy.disallow.length === 0) return true;

  const bare = path.split("?")[0].split("#")[0];
  const normalized = bare.startsWith("/") ? bare : `/${bare}`;
  return !policy.disallow.some((prefix) => normalized.startsWith(prefix));
}
