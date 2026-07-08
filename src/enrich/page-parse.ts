import * as cheerio from "cheerio";

/**
 * The PURE half of the scraper: given a homepage's HTML, which of its own pages
 * are worth holding, and what does a JS-only shell still tell us? No network, no
 * cheerio outside this file's own `load`, no decisions about fetching.
 *
 * Split out of `scrape.ts` so link discovery and the SPA fallback unit-test with
 * a string instead of a fetcher, and so neither file takes on a second job.
 */

/**
 * Healthcare-tuned buckets. `team` first, on purpose: the decision-maker is the
 * single fact PDL cannot sell us and the brief cannot omit, and `BUCKET_ORDER`
 * doubles as the priority order the total-text budget is spent in. When the cap
 * bites, it bites `news` — never the staff page.
 */
export const LINK_BUCKETS = {
  team: [
    "team", "our-team", "meet-the-team", "meet-our-team", "staff", "providers",
    "our-providers", "physicians", "our-physicians", "doctors", "our-doctors",
    "practitioners", "leadership", "provider",
  ],
  about: [
    "about", "about-us", "our-story", "who-we-are", "our-practice", "history",
    "mission", "philosophy",
  ],
  locations: [
    "locations", "location", "offices", "our-locations", "find-us", "contact",
    "contact-us", "directions",
  ],
  services: [
    "services", "our-services", "treatments", "procedures", "specialties",
    "what-we-treat", "conditions",
  ],
  patients: [
    "patients", "new-patients", "new-patient", "patient-info", "patient-resources",
    "patient-portal", "first-visit", "forms", "insurance",
  ],
  careers: ["careers", "jobs", "join-our-team", "employment", "work-with-us", "join-us"],
  news: ["news", "blog", "press", "announcements", "media", "updates"],
} as const;

export type LinkBucket = keyof typeof LINK_BUCKETS;

/** Priority order: highest-value page first. See the note on LINK_BUCKETS. */
export const BUCKET_ORDER: readonly LinkBucket[] = [
  "team", "about", "locations", "services", "patients", "careers", "news",
];

const ASSET_EXTENSION =
  /\.(jpe?g|png|gif|svg|webp|avif|ico|pdf|css|js|mjs|json|xml|rss|mp4|mp3|wav|woff2?|ttf|eot|zip|docx?|xlsx?|pptx?)$/i;

/** Framework and CMS plumbing. Never prose, always tokens. */
const NOISE_PREFIXES = ["/wp-", "/_next", "/cdn-", "/_nuxt", "/assets/", "/static/"];

export interface DiscoveredLinks {
  /** Same-host, noise-filtered, deduped. ORIGINAL case — see `normalizePathKey`. */
  paths: string[];
  buckets: Record<LinkBucket, string[]>;
}

function emptyBuckets(): Record<LinkBucket, string[]> {
  return { team: [], about: [], locations: [], services: [], patients: [], careers: [], news: [] };
}

/**
 * Lowercase ONLY for matching and dedupe. The path we actually fetch keeps its
 * original case: a case-sensitive host serves `/OurTeam` and 404s `/ourteam`, and
 * Optiflow's lowercase-then-fetch silently loses the staff page on those hosts.
 */
function normalizePathKey(path: string): string {
  return path.toLowerCase();
}

/** `null` = not a page we crawl (the homepage itself, an asset, framework noise). */
function keepablePath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === "") return null;
  const key = normalizePathKey(path);
  if (ASSET_EXTENSION.test(key)) return null;
  if (NOISE_PREFIXES.some((prefix) => key.startsWith(prefix))) return null;
  return path;
}

/** First bucket in BUCKET_ORDER wins, so `/about/our-team` is a team page. */
export function bucketFor(path: string): LinkBucket | null {
  const segments = normalizePathKey(path).split("/").filter(Boolean);
  const slug = segments[0] ?? "";
  const joined = segments.join("/");

  for (const bucket of BUCKET_ORDER) {
    const matched = LINK_BUCKETS[bucket].some(
      (kw) => slug === kw || slug.startsWith(`${kw}-`) || joined.includes(kw),
    );
    if (matched) return bucket;
  }
  return null;
}

/**
 * Same-host `<a href>` discovery. `new URL(href, origin)` resolves relative,
 * absolute, and protocol-relative hrefs uniformly, and gives `mailto:` / `tel:` /
 * `javascript:` an empty hostname — so the host check excludes them without a
 * scheme allowlist. `//cdn.example.com/x` resolves to a foreign host and is dropped.
 *
 * The try/catch LOOKS like the safety guard and is not. `new URL` with a base only
 * throws on a handful of inputs (`href="http://"`); an unparseable scheme such as
 * `ht!tp:` is silently treated as a path segment and passes the host check. So junk
 * can reach `paths`. What keeps it from ever being FETCHED is that `scrape.ts` only
 * requests paths that landed in a bucket, and junk lands in no bucket.
 */
export function discoverLinks(html: string, origin: string): DiscoveredLinks {
  const $ = cheerio.load(html);
  const originHost = new URL(origin).hostname;

  const seen = new Set<string>();
  const paths: string[] = [];
  const buckets = emptyBuckets();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    let parsed: URL;
    try {
      parsed = new URL(href, origin);
    } catch {
      return;
    }
    if (parsed.hostname !== originHost) return;

    const path = keepablePath(parsed.pathname);
    if (path === null) return;

    const key = normalizePathKey(path);
    if (seen.has(key)) return;
    seen.add(key);

    paths.push(path);
    const bucket = bucketFor(path);
    if (bucket) buckets[bucket].push(path);
  });

  return { paths, buckets };
}

// ─── SPA fallback ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Flatten one JSON-LD document into the business facts a brief can cite. */
function jsonLdFacts(raw: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return []; // Malformed JSON-LD is common. It is not an error, it is just absent.
  }

  const graph = isRecord(data) && Array.isArray(data["@graph"]) ? data["@graph"] : null;
  const items: unknown[] = Array.isArray(data) ? data : (graph ?? [data]);

  const facts: string[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;

    const name = asText(item.name);
    if (name) facts.push(`Business: ${name}`);

    const description = asText(item.description);
    if (description) facts.push(description);

    const address = isRecord(item.address) ? item.address : null;
    const street = address && asText(address.streetAddress);
    if (address && street) {
      const locality = asText(address.addressLocality) ?? "";
      const region = asText(address.addressRegion) ?? "";
      facts.push(`Address: ${[street, locality, region].filter(Boolean).join(", ")}`);
    }

    const telephone = asText(item.telephone);
    if (telephone) facts.push(`Phone: ${telephone}`);

    const specialty = asText(item.medicalSpecialty);
    if (specialty) facts.push(`Specialty: ${specialty}`);
  }
  return facts;
}

/**
 * When a page is a JS shell, its `<body>` is empty but its `<head>` still carries
 * real, citable business facts. Labels (`Business:`, `Phone:`) are ADDITIVE — the
 * value stays a verbatim substring, so a snippet quoting it still verifies (M2).
 */
export function extractMetaFallback(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];

  const title = $("title").first().text().trim();
  if (title) parts.push(`# ${title}`);

  const description = $('meta[name="description"]').attr("content")?.trim();
  if (description) parts.push(description);

  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  if (ogTitle && ogTitle !== title) parts.push(ogTitle);

  const ogDescription = $('meta[property="og:description"]').attr("content")?.trim();
  if (ogDescription && ogDescription !== description) parts.push(ogDescription);

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (raw) parts.push(...jsonLdFacts(raw));
  });

  return parts.join("\n\n");
}

// ─── URL normalization ────────────────────────────────────────────────────────

export interface SiteUrl {
  /** The page to start from. May be a sub-path (`/locations/omaha`). */
  base: string;
  /** `https://host` — every discovered path resolves against this. */
  origin: string;
}

/** `null` when the string is not a URL we can fetch at all. */
export function normalizeSiteUrl(raw: string): SiteUrl | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;

  const path = url.pathname.replace(/\/+$/, "");
  return { base: `${url.origin}${path}`, origin: url.origin };
}
