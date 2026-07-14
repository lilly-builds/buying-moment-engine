import { cleanHtml, TRUNCATION_MARKER } from "./html-clean";
import {
  isTransientStatus,
  TransientHttpError,
  withRetry,
} from "./fetch-retry";
import {
  BUCKET_ORDER,
  discoverLinks,
  extractMetaFallback,
  normalizeSiteUrl,
} from "./page-parse";
import { isAllowed, parseRobotsTxt, type RobotsPolicy } from "./robots";
import { extractCompanySocialLinks, type CompanySocialLinks } from "./social-links";
import { guardedFetch, type DnsLookupAll } from "./url-guard";

/**
 * Fetch a practice's OWN pages and hold their text, keyed by absolute URL.
 *
 * This is the single most important divergence from `lead-gen-optiflow`'s
 * `scrapeWebsite()` (KTD-3). Optiflow joins every page into one `combined_text`
 * blob under `=== SERVICES PAGE ===` headers and throws away which page each chunk
 * came from. That is fine for writing a voicemail. Here the map IS the citation
 * substrate: without it, `citations.ts` cannot ask "does this snippet appear on
 * the page the model cited?", and D2 stays a promise instead of a test.
 *
 * We choose the pages (by keyword bucket, not by judgement); the model only reads.
 * No agent, no browser, no `web_fetch` — one plain `fetch` per page.
 */

/**
 * We say who we are. E4 measured the tradeoff and found none: an honest UA gets
 * 10/10 cohort homepages, exactly as a spoofed Chrome UA does. Spoofing would buy
 * nothing and cost the one claim this repo is built on.
 */
export const SCRAPE_USER_AGENT =
  "BuyingMomentEngine/1.0 (+https://github.com/lilly-builds/buying-moment-engine)";

const SCRAPE_HEADERS: Record<string, string> = {
  "User-Agent": SCRAPE_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Per page. Sub-300s by miles, so `AbortSignal.timeout` is real here (unlike E2). */
export const PAGE_FETCH_TIMEOUT_MS = 10_000;
export const ROBOTS_FETCH_TIMEOUT_MS = 5_000;

/**
 * Across ALL pages. `cleanHtml` caps each page at 8k chars; without a cross-page
 * ceiling a link-heavy site would still blow past the E5 cost band. 50k chars is
 * ~12.5k input tokens ~= $0.0125 on Haiku — inside M3's $0.02/practice bar with
 * room for the output tokens.
 */
export const SCRAPE_TOTAL_TEXT_CAP = 50_000;

/** A homepage below this much text, with real HTML behind it, is a JS shell. */
export const SPA_MIN_TEXT_CHARS = 100;
export const SPA_MIN_HTML_CHARS = 500;

export const SCRAPE_MAX_RETRIES = 2;
export const SCRAPE_RETRY_BASE_MS = 300;

export type ScrapeFailure = "invalid-url" | "blocked" | "unreachable" | "empty";

export interface ScrapeResult {
  /** absolute URL -> cleaned text. Empty when `reason` is set. */
  pages: Map<string, string>;
  /** Observability: a practice enriching from 1 page instead of 7 must be visible. */
  pagesHeld: number;
  totalChars: number;
  reason?: ScrapeFailure;
  socialLinks: CompanySocialLinks;
}

export interface ScrapeDeps {
  fetch: typeof fetch;
  /** Injected so backoff tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
  /**
   * SSRF defence (COV-04). When supplied, a hostname is resolved and every address
   * range-checked before the fetch. Literal internal addresses and `localhost` are
   * always refused regardless. Omitted in hermetic tests so no real DNS is done.
   */
  lookup?: DnsLookupAll;
}

type Logger = NonNullable<ScrapeDeps["logger"]>;

function defaultLogger(event: string, meta?: Record<string, unknown>): void {
  console.warn(event, meta ?? {});
}

function failed(reason: ScrapeFailure): ScrapeResult {
  return {
    pages: new Map(),
    pagesHeld: 0,
    totalChars: 0,
    reason,
    socialLinks: {
      linkedinUrl: null,
      facebookUrl: null,
      instagramUrl: null,
      sources: { linkedin: null, facebook: null, instagram: null },
    },
  };
}

interface RawPage {
  status: number;
  html: string;
  /**
   * `res.url` — where the bytes ACTUALLY came from. With `redirect: "follow"` this is
   * the end of the redirect chain, which may be a host we never asked about and whose
   * `robots.txt` we have therefore never read. Discarding it is R3.
   */
  finalUrl: string;
}

/**
 * One HTTP GET. A transient status becomes a THROW so `withRetry` can see it —
 * `fetch` resolves happily on a 503. A 4xx is the server's final answer and is
 * returned, not thrown: 404 drives the sub-path fallback, 403 drives `blocked`.
 */
async function fetchOnce(
  deps: ScrapeDeps,
  url: string,
  timeoutMs: number,
): Promise<RawPage> {
  // `guardedFetch` validates `url` and every redirect hop against the SSRF block-list
  // BEFORE the request is made, and follows redirects manually so an off-origin hop to
  // an internal address is refused, not merely discarded after the bytes arrive.
  const { response, finalUrl } = await guardedFetch(
    deps.fetch,
    url,
    { headers: SCRAPE_HEADERS, signal: AbortSignal.timeout(timeoutMs) },
    { lookup: deps.lookup },
  );
  if (isTransientStatus(response.status)) throw new TransientHttpError(response.status, url);
  // `finalUrl` is the end of the redirect chain — the host the bytes ACTUALLY came from.
  return { status: response.status, html: response.ok ? await response.text() : "", finalUrl };
}

/** `null` when the response carried no usable final URL. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** `null` = we gave up on this page. Never throws: one bad page is not a bad practice. */
async function fetchPage(
  deps: ScrapeDeps,
  url: string,
  log: Logger,
): Promise<RawPage | null> {
  try {
    return await withRetry(() => fetchOnce(deps, url, PAGE_FETCH_TIMEOUT_MS), {
      maxRetries: SCRAPE_MAX_RETRIES,
      baseDelayMs: SCRAPE_RETRY_BASE_MS,
      label: `scrape ${url}`,
      sleep: deps.sleep,
      jitter: deps.jitter,
    });
  } catch (err) {
    log("scrape.page_failed", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Once per origin, and never retried: a missing `robots.txt` MEANS allow, so a
 * retry would spend wall-clock to reach the answer we already have.
 *
 * `res.url` is deliberately NOT read here, unlike in `fetchOnce`. RFC 9309 §2.3.1.2 says
 * a redirected `robots.txt` still governs the authority that was ASKED — so a redirect is
 * exactly what we want followed, and the policy still belongs to `origin`.
 */
async function fetchRobots(
  deps: ScrapeDeps,
  origin: string,
  log: Logger,
): Promise<RobotsPolicy | null> {
  try {
    const { response } = await guardedFetch(
      deps.fetch,
      `${origin}/robots.txt`,
      { headers: SCRAPE_HEADERS, signal: AbortSignal.timeout(ROBOTS_FETCH_TIMEOUT_MS) },
      { lookup: deps.lookup },
    );
    if (!response.ok) return null;
    return parseRobotsTxt(await response.text());
  } catch (err) {
    log("scrape.robots_unreachable", {
      origin,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Body text, or the `<head>`'s facts when the body is a JS shell. */
function homepageText(html: string): string {
  const text = cleanHtml(html);
  if (text.length >= SPA_MIN_TEXT_CHARS || html.length <= SPA_MIN_HTML_CHARS) return text;

  const meta = extractMetaFallback(html);
  return meta.length > text.length ? meta : text;
}

/**
 * Spend the cross-page text budget in `entries` order (homepage, then BUCKET_ORDER),
 * so a cap that bites drops `news`, never the staff page. The page that crosses the
 * line is clipped and marked rather than dropped whole — a partial team page still
 * carries the decision-maker's name.
 */
function emptySocialLinks(): CompanySocialLinks {
  return {
    linkedinUrl: null,
    facebookUrl: null,
    instagramUrl: null,
    sources: { linkedin: null, facebook: null, instagram: null },
  };
}

function assemble(
  entries: Array<[string, string]>,
  socialLinks: CompanySocialLinks = emptySocialLinks(),
): ScrapeResult {
  const pages = new Map<string, string>();
  let totalChars = 0;

  for (const [url, text] of entries) {
    if (text.length === 0) continue;

    const remaining = SCRAPE_TOTAL_TEXT_CAP - totalChars;
    if (remaining <= TRUNCATION_MARKER.length) break;

    const clipped =
      text.length <= remaining
        ? text
        : text.slice(0, remaining - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;

    pages.set(url, clipped);
    totalChars += clipped.length;
  }

  return { pages, pagesHeld: pages.size, totalChars, socialLinks };
}

export async function scrapePractice(
  deps: ScrapeDeps,
  websiteUrl: string,
): Promise<ScrapeResult> {
  const log = deps.logger ?? defaultLogger;

  const site = normalizeSiteUrl(websiteUrl);
  if (!site) return failed("invalid-url");

  let origin = site.origin;
  let policy = await fetchRobots(deps, origin, log);

  let homeUrl = site.base;
  if (!isAllowed(policy, new URL(homeUrl).pathname)) {
    log("scrape.robots_denied_homepage", { url: homeUrl });
    return failed("blocked");
  }

  let home = await fetchPage(deps, homeUrl, log);
  // A practice record can carry a deep link (`/locations/omaha`) that has since
  // 404'd. The origin root almost always still serves the site.
  if (home?.status === 404 && site.base !== site.origin) {
    homeUrl = site.origin;
    home = isAllowed(policy, "/") ? await fetchPage(deps, homeUrl, log) : null;
  }

  if (home === null) {
    log("scrape.homepage_unusable", { url: homeUrl, status: null });
    return failed("unreachable");
  }
  if (home.status < 200 || home.status >= 300) {
    const blocked = home.status === 401 || home.status === 403;
    log("scrape.homepage_unusable", { url: homeUrl, status: home.status });
    return failed(blocked ? "blocked" : "unreachable");
  }

  // R3. We followed a redirect to get here, and it may have carried us to a different
  // host — an acquired practice 301'ing to its parent DSO, or the everyday apex -> `www.`
  // hop. Two things are then wrong at once: we hold a page whose `robots.txt` we never
  // read, and `discoverLinks` is about to resolve relative links against a host that no
  // longer serves them. Re-read the rules, re-base the crawl, and only then continue.
  //
  // NOT simply `blocked`: `https://toa.com/` -> `https://www.toa.com` is extremely common,
  // and refusing it to be safe would silently delete real practices from the pipeline.
  const landed = normalizeSiteUrl(home.finalUrl);
  if (landed && landed.origin !== origin) {
    log("scrape.redirected_off_origin", { from: homeUrl, to: landed.base });
    origin = landed.origin;
    homeUrl = landed.base;
    policy = await fetchRobots(deps, origin, log);
    if (!isAllowed(policy, new URL(homeUrl).pathname)) {
      log("scrape.robots_denied_homepage", { url: homeUrl });
      return failed("blocked");
    }
  }

  const rawPages: Array<{ sourceUrl: string; html: string }> = [
    { sourceUrl: homeUrl, html: home.html },
  ];

  const { buckets } = discoverLinks(home.html, origin);
  const targets = BUCKET_ORDER.flatMap((bucket) => {
    const path = buckets[bucket].find((candidate) => isAllowed(policy, candidate));
    if (path === undefined) return [];
    const url = `${origin}${path}`;
    return url === homeUrl ? [] : [{ bucket, url }];
  });

  // `allSettled`, not `all`: one bucket must never sink the practice. `fetchPage`
  // already swallows its own failures, so this is defence in depth, not the only guard.
  const settled = await Promise.allSettled(
    targets.map(async (target) => ({
      url: target.url,
      page: await fetchPage(deps, target.url, log),
    })),
  );

  const entries: Array<[string, string]> = [[homeUrl, homepageText(home.html)]];
  for (const outcome of settled) {
    if (outcome.status !== "fulfilled") continue;
    const { url, page } = outcome.value;
    if (page === null || page.status < 200 || page.status >= 300) continue;

    // A page that redirected off-origin is text from a host whose rules we never read.
    // Keying it under the URL we requested would also break KTD-3: the citation would
    // name a page that does not serve those words. A same-origin redirect is fine — the
    // URL we hold still resolves to the text we hold.
    const landedOrigin = originOf(page.finalUrl);
    if (landedOrigin !== null && landedOrigin !== origin) {
      log("scrape.page_left_origin", { requested: url, landed: page.finalUrl });
      continue;
    }
    rawPages.push({ sourceUrl: url, html: page.html });
    entries.push([url, cleanHtml(page.html)]);
  }

  const result = assemble(entries, extractCompanySocialLinks(rawPages));
  if (result.pagesHeld === 0) {
    log("scrape.no_text", { url: homeUrl });
    return failed("empty");
  }

  log("scrape.held", {
    url: homeUrl,
    pagesHeld: result.pagesHeld,
    totalChars: result.totalChars,
  });
  return result;
}
