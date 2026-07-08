import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HTML_TEXT_CAP, TRUNCATION_MARKER } from "@/src/enrich/html-clean";
import { scrapePractice, SCRAPE_TOTAL_TEXT_CAP, SCRAPE_USER_AGENT } from "@/src/enrich/scrape";

/**
 * The scraper's seams, driven through an injected `fetch`. No network.
 *
 * The assertion that matters most across this file is on the FETCHER'S CALL LIST:
 * a robots-denied page must never be requested, not merely discarded after it lands.
 */

const ORIGIN = "https://sunshinederm.example";
const HOME_HTML = readFileSync(new URL("./fixtures/site-home.html", import.meta.url), "utf8");
const SPA_HTML = readFileSync(new URL("./fixtures/site-spa-home.html", import.meta.url), "utf8");

/** Six bucket links + a homepage = seven pages held. */
const BUCKET_URLS = [
  `${ORIGIN}/OurTeam`,
  `${ORIGIN}/about-us`,
  `${ORIGIN}/locations`,
  `${ORIGIN}/services`,
  `${ORIGIN}/new-patients`,
  `${ORIGIN}/careers`,
];

function page(seed: string, paragraphs = 4): string {
  const body = Array.from(
    { length: paragraphs },
    (_, i) => `<p>${seed} paragraph ${i} with plenty of words to clear the floor.</p>`,
  ).join("");
  return `<body><h1>${seed}</h1>${body}</body>`;
}

/** Enough unique prose that `cleanHtml`'s 8k per-page cap always bites. */
function hugePage(seed: string): string {
  return page(seed, 200);
}

type Route = () => Response;

class FakeFetcher {
  readonly calls: string[] = [];

  constructor(private readonly routes: Record<string, Route>) {}

  readonly fetch: typeof fetch = async (input) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    this.calls.push(url);
    const route = this.routes[url];
    return route ? route() : new Response("", { status: 404 });
  };

  callsTo(url: string): number {
    return this.calls.filter((c) => c === url).length;
  }
}

const html = (body: string): Route => () => new Response(body, { status: 200 });
const status = (code: number): Route => () => new Response("", { status: code });
const robots = (body: string): Route => () => new Response(body, { status: 200 });

/** Nothing sleeps, nothing jitters, nothing logs. */
const DEPS = { sleep: async () => {}, jitter: () => 0, logger: () => {} };

function fullSite(overrides: Record<string, Route> = {}): FakeFetcher {
  const routes: Record<string, Route> = {
    [`${ORIGIN}/robots.txt`]: status(404),
    [ORIGIN]: html(HOME_HTML),
  };
  for (const url of BUCKET_URLS) routes[url] = html(page(url));
  return new FakeFetcher({ ...routes, ...overrides });
}

describe("scrapePractice — the citation substrate", () => {
  it("holds the homepage plus one page per bucket, keyed by ABSOLUTE url", async () => {
    const fetcher = fullSite();
    const result = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);

    expect(result.reason).toBeUndefined();
    expect(result.pagesHeld).toBe(7);
    expect([...result.pages.keys()].sort()).toEqual([ORIGIN, ...BUCKET_URLS].sort());
    for (const key of result.pages.keys()) expect(key.startsWith("https://")).toBe(true);
  });

  it("KTD-3: text is keyed per page, never a flattened blob", async () => {
    const fetcher = fullSite();
    const { pages } = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);

    // The team page's words live under the team page's URL, and nowhere else.
    expect(pages.get(`${ORIGIN}/OurTeam`)).toContain("/OurTeam paragraph 0");
    expect(pages.get(ORIGIN)).not.toContain("/OurTeam paragraph 0");
  });

  it("identifies itself honestly on every request (M6/KTD-6)", async () => {
    const fetcher = fullSite();
    let seenAgent: string | null = null;
    const spy: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seenAgent = headers.get("user-agent");
      return fetcher.fetch(input, init);
    };
    await scrapePractice({ fetch: spy, ...DEPS }, ORIGIN);
    expect(seenAgent).toBe(SCRAPE_USER_AGENT);
  });

  it("fetches robots.txt exactly ONCE across a multi-page scrape", async () => {
    const fetcher = fullSite();
    await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);
    expect(fetcher.callsTo(`${ORIGIN}/robots.txt`)).toBe(1);
  });

  it("NEVER FETCHES a path robots.txt denies", async () => {
    const fetcher = fullSite({
      [`${ORIGIN}/robots.txt`]: robots("User-agent: *\nDisallow: /careers"),
    });
    const result = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);

    expect(fetcher.calls).not.toContain(`${ORIGIN}/careers`);
    expect(result.pages.has(`${ORIGIN}/careers`)).toBe(false);
    expect(result.pagesHeld).toBe(6);
  });

  it("`Disallow: /` blocks the homepage itself, and nothing is fetched", async () => {
    const fetcher = fullSite({
      [`${ORIGIN}/robots.txt`]: robots("User-agent: *\nDisallow: /"),
    });
    const result = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);

    expect(result.reason).toBe("blocked");
    expect(result.pagesHeld).toBe(0);
    expect(fetcher.calls).toEqual([`${ORIGIN}/robots.txt`]);
  });

  it("a homepage 403 returns an empty map with reason `blocked`, and never throws", async () => {
    const fetcher = fullSite({ [ORIGIN]: status(403) });
    const result = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);

    expect(result.reason).toBe("blocked");
    expect(result.pages.size).toBe(0);
  });

  it("a homepage that never answers returns reason `unreachable`, and never throws", async () => {
    const boom: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    };
    const result = await scrapePractice({ fetch: boom, ...DEPS }, ORIGIN);
    expect(result.reason).toBe("unreachable");
  });

  it("a bucket page returning 500 is skipped; every other bucket still lands", async () => {
    const fetcher = fullSite({ [`${ORIGIN}/services`]: status(500) });
    const result = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);

    expect(result.pages.has(`${ORIGIN}/services`)).toBe(false);
    expect(result.pagesHeld).toBe(6);
    expect(result.pages.has(`${ORIGIN}/OurTeam`)).toBe(true);
    // ...and it was retried before being given up on.
    expect(fetcher.callsTo(`${ORIGIN}/services`)).toBe(3);
  });

  it("a bucket page 404 is skipped without retrying — 404 is a final answer", async () => {
    const fetcher = fullSite({ [`${ORIGIN}/careers`]: status(404) });
    const result = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);

    expect(result.pagesHeld).toBe(6);
    expect(fetcher.callsTo(`${ORIGIN}/careers`)).toBe(1);
  });

  it("a sub-path 404 falls back to the origin root", async () => {
    const deep = `${ORIGIN}/locations/omaha`;
    const fetcher = fullSite({ [deep]: status(404) });
    const result = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, deep);

    expect(fetcher.calls).toContain(deep);
    expect(result.pages.has(ORIGIN)).toBe(true);
    expect(result.pagesHeld).toBe(7);
  });

  it("a SPA homepage falls back to its meta / JSON-LD facts", async () => {
    const fetcher = new FakeFetcher({
      [`${ORIGIN}/robots.txt`]: status(404),
      [ORIGIN]: html(SPA_HTML),
    });
    const result = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);

    const text = result.pages.get(ORIGIN) ?? "";
    expect(text).toContain("Business: Westlake Dermatology");
    expect(text).toContain("Phone: (512) 328-3376");
  });

  it("enforces the total text cap ACROSS pages, not just per page", async () => {
    const routes: Record<string, Route> = {
      [`${ORIGIN}/robots.txt`]: status(404),
      [ORIGIN]: html(HOME_HTML.replace("</main>", `${hugePage("home")}</main>`)),
    };
    for (const url of BUCKET_URLS) routes[url] = html(hugePage(url));
    const fetcher = new FakeFetcher(routes);

    const result = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);

    // Each page alone is under the per-page cap...
    for (const text of result.pages.values()) {
      expect(text.length).toBeLessThanOrEqual(HTML_TEXT_CAP + TRUNCATION_MARKER.length);
    }
    // ...and the run as a whole is under the cross-page cap.
    expect(result.totalChars).toBeLessThanOrEqual(SCRAPE_TOTAL_TEXT_CAP);
    expect(result.totalChars).toBeGreaterThan(SCRAPE_TOTAL_TEXT_CAP - HTML_TEXT_CAP);

    // The budget is spent in priority order: the team page survives, `news` would not.
    expect(result.pages.has(`${ORIGIN}/OurTeam`)).toBe(true);
  });

  it("only BUCKETED paths are ever fetched — discovered junk is never requested", async () => {
    const fetcher = fullSite();
    await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);

    // The fixture links a PDF, an image, /wp-admin, /_next, an off-host page, a
    // `mailto:` and a `#top`. Every request we made is robots.txt, the homepage,
    // or one of the six buckets — nothing else, ever.
    const allowed = new Set([`${ORIGIN}/robots.txt`, ORIGIN, ...BUCKET_URLS]);
    expect(fetcher.calls.filter((c) => !allowed.has(c))).toEqual([]);
  });

  it("EDGE CASE: an unparseable website URL fails fast, with zero fetches", async () => {
    const fetcher = fullSite();
    const result = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, "not a url");

    expect(result.reason).toBe("invalid-url");
    expect(fetcher.calls).toEqual([]);
  });

  it("EDGE CASE: a 200 homepage with no text at all yields reason `empty`", async () => {
    const fetcher = new FakeFetcher({
      [`${ORIGIN}/robots.txt`]: status(404),
      [ORIGIN]: html("<body></body>"),
    });
    const result = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);
    expect(result.reason).toBe("empty");
  });

  it("an unreachable robots.txt means ALLOW, not abort", async () => {
    const fetcher = fullSite({
      [`${ORIGIN}/robots.txt`]: () => {
        throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
      },
    });
    const result = await scrapePractice({ fetch: fetcher.fetch, ...DEPS }, ORIGIN);
    expect(result.pagesHeld).toBe(7);
  });
});
