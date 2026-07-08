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
}

export interface ScrapeDeps {
  fetch: typeof fetch;
  /** Injected so backoff tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}

type Logger = NonNullable<ScrapeDeps["logger"]>;

function defaultLogger(event: string, meta?: Record<string, unknown>): void {
  console.warn(event, meta ?? {});
}

function failed(reason: ScrapeFailure): ScrapeResult {
  return { pages: new Map(), pagesHeld: 0, totalChars: 0, reason };
}

interface RawPage {
  status: number;
  html: string;
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
  const res = await deps.fetch(url, {
    headers: SCRAPE_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (isTransientStatus(res.status)) throw new TransientHttpError(res.status, url);
  return { status: res.status, html: res.ok ? await res.text() : "" };
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
 */
async function fetchRobots(
  deps: ScrapeDeps,
  origin: string,
  log: Logger,
): Promise<RobotsPolicy | null> {
  try {
    const res = await deps.fetch(`${origin}/robots.txt`, {
      headers: SCRAPE_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(ROBOTS_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseRobotsTxt(await res.text());
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
function assemble(entries: Array<[string, string]>): ScrapeResult {
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

  return { pages, pagesHeld: pages.size, totalChars };
}

export async function scrapePractice(
  deps: ScrapeDeps,
  websiteUrl: string,
): Promise<ScrapeResult> {
  const log = deps.logger ?? defaultLogger;

  const site = normalizeSiteUrl(websiteUrl);
  if (!site) return failed("invalid-url");

  const policy = await fetchRobots(deps, site.origin, log);

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

  const { buckets } = discoverLinks(home.html, site.origin);
  const targets = BUCKET_ORDER.flatMap((bucket) => {
    const path = buckets[bucket].find((candidate) => isAllowed(policy, candidate));
    if (path === undefined) return [];
    const url = `${site.origin}${path}`;
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
    entries.push([url, cleanHtml(page.html)]);
  }

  const result = assemble(entries);
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
