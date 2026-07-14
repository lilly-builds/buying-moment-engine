import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import type { SignalCandidate } from "@/src/engine/detector";
import { classifyGrowthEvent } from "./growth-events-classifier";

/**
 * GDELT DOC 2.0 adapter for U4 (see `growth-events.recon.md` for the source
 * decision + ToS basis). Normalize is PURE (article JSON in, `SignalCandidate |
 * null` out) — unit-testable with no mocks. `fetchGdeltArticles` is the only
 * I/O here, and it is thin by design: build the query URL, fetch, return raw
 * JSON for the caller to validate.
 */

const gdeltArticleSchema = z.object({
  url: z.url(),
  title: z.string(),
  description: z.string().optional(),
  seendate: z.string().optional(),
  domain: z.string().optional(),
  language: z.string().optional(),
  sourcecountry: z.string().optional(),
});

export const gdeltSearchResponseSchema = z.object({
  articles: z.array(gdeltArticleSchema),
});

export type GdeltArticle = z.output<typeof gdeltArticleSchema>;
export type GdeltSearchResponse = z.output<typeof gdeltSearchResponseSchema>;

export interface GrowthEventsQuery {
  /** GDELT DOC 2.0 boolean query string, e.g. `(acquires OR "private equity") dental`. */
  query: string;
  /** GDELT `maxrecords` (1-250). Defaults to 75 when omitted. */
  maxRecords?: number;
  /** Optional GDELT GKG fallback window. Defaults to 0 (disabled). */
  recentGkgFiles?: number;
}

/** Injected fetcher — tests supply a fixture; production calls the real API. */
export type FetchArticlesFn = (query: GrowthEventsQuery) => Promise<unknown>;

/** Parses GDELT's compact `YYYYMMDDTHHMMSSZ` seendate into a Date, or undefined if unparseable. */
function parseGdeltSeenDate(seendate: string | undefined): Date | undefined {
  if (!seendate) return undefined;
  const match = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match;
  const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Deterministic geo-key slug from GDELT's country-level `sourcecountry`, e.g. "United States" -> "united-states". */
function slugifyGeo(country: string): string {
  return country
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferVertical(text: string): SignalCandidate["vertical"] | undefined {
  const lower = text.toLowerCase();
  if (lower.includes("dermatology") || lower.includes("skin care")) return "dermatology";
  if (lower.includes("women") || lower.includes("ob/gyn") || lower.includes("obgyn")) {
    return "womens_health";
  }
  if (lower.includes("orthopedic") || lower.includes("orthopaedic")) return "orthopedics";
  if (lower.includes("ophthalmology") || lower.includes("retina")) return "ophthalmology";
  return undefined;
}

/**
 * Pure normalize: one GDELT article -> one `SignalCandidate`, or `null` when
 * the title isn't a growth event or doesn't name an attributable practice
 * (R7 precision guard, delegated to the classifier).
 */
export function normalizeArticleToCandidate(
  article: GdeltArticle,
  now: Date,
): SignalCandidate | null {
  let classification = classifyGrowthEvent(article.title);
  if (!classification.isGrowthEvent && article.description) {
    classification = classifyGrowthEvent(article.description);
  }
  if (!classification.isGrowthEvent || !classification.practiceHint) return null;

  const detectedAt = parseGdeltSeenDate(article.seendate) ?? now;

  const candidate: SignalCandidate = {
    practiceHint: classification.practiceHint,
    kind: "growth_events",
    confidence: classification.confidence,
    detectedAt,
    evidence: [
      {
        claim: `News article: "${article.title}" — growth event (matched "${classification.matchedPhrase}")`,
        sourceUrl: article.url,
        snippet: article.description?.slice(0, 240),
        confidence: classification.confidence,
      },
    ],
  };

  if (article.sourcecountry) candidate.geoKey = slugifyGeo(article.sourcecountry);
  candidate.vertical = inferVertical(`${article.title} ${article.description ?? ""}`);
  return candidate;
}

const GDELT_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_MASTER_FILE_LIST = "http://data.gdeltproject.org/gdeltv2/masterfilelist.txt";
/** Keyless, free-tier API today — metered at $0 for a complete R19 ledger (see recon memo). */
export const GDELT_UNIT_COST_USD = 0;
/** Bounded network timeout — a hung upstream must not block the sequential detector cron. */
export const DETECTOR_FETCH_TIMEOUT_MS = 10_000;

const GKG_MEDICAL_TERMS = [
  "dermatology",
  "orthopedic",
  "orthopaedic",
  "retina",
  "ophthalmology",
  "obgyn",
  "ob-gyn",
  "womens-health",
  "women-s-health",
  "women-s-health",
  "medical-group",
  "clinic",
  "veterinary",
  "vet-",
];

const GKG_GROWTH_TERMS = [
  "opens-new",
  "new-location",
  "new-office",
  "new-facility",
  "expanded-facility",
  "expands",
  "expansion",
  "acquires",
  "acquired",
  "merger",
  "welcomes",
  "adds-new-provider",
];

function domainOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function titleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? url;
    return path
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

function metaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const match = html.match(re);
  return match?.[1]
    ?.replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "’")
    .replace(/&rsquo;/g, "’")
    .replace(/&#039;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

async function enrichArticleFromPublisher(url: string): Promise<Pick<GdeltArticle, "title" | "description">> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DETECTOR_FETCH_TIMEOUT_MS) });
    if (!res.ok) return { title: titleFromUrl(url) };
    const html = await res.text();
    const title =
      metaContent(html, "og:title") ??
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ??
      titleFromUrl(url);
    const description = metaContent(html, "og:description") ?? metaContent(html, "description");
    return { title, description };
  } catch {
    return { title: titleFromUrl(url) };
  }
}

async function fetchRecentGkgArticles(maxRecords: number, recentFiles: number): Promise<GdeltSearchResponse> {
  // Server-side read of a PUBLIC GDELT data feed that GDELT serves over HTTP only; no
  // credentials or user data are sent, and this is a Node cron detector, not a React
  // browser request (the react-insecure-request rule misfires on server code).
  // nosemgrep: typescript.react.security.react-insecure-request
  const master = await fetch(GDELT_MASTER_FILE_LIST, {
    signal: AbortSignal.timeout(DETECTOR_FETCH_TIMEOUT_MS),
  });
  if (!master.ok) throw new Error(`GDELT GKG master list error: ${master.status} ${master.statusText}`);
  const lines = (await master.text()).split(/\r?\n/);
  const files = lines
    .map((line) => line.trim().split(/\s+/).at(-1) ?? "")
    .filter((url) => url.endsWith(".gkg.csv.zip"))
    .slice(-recentFiles);

  const urls: string[] = [];
  for (const file of files.reverse()) {
    if (urls.length >= maxRecords) break;
    try {
      const res = await fetch(file, { signal: AbortSignal.timeout(DETECTOR_FETCH_TIMEOUT_MS) });
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      const csv = unzipFirstFile(bytes).toString("utf8");
      for (const line of csv.split(/\r?\n/)) {
        const parts = line.split("\t");
        const articleUrl = parts[4];
        if (!articleUrl) continue;
        const lower = articleUrl.toLowerCase();
        if (!GKG_MEDICAL_TERMS.some((term) => lower.includes(term))) continue;
        if (!GKG_GROWTH_TERMS.some((term) => lower.includes(term))) continue;
        if (!urls.includes(articleUrl)) urls.push(articleUrl);
        if (urls.length >= maxRecords) break;
      }
    } catch {
      continue;
    }
  }

  const articles: GdeltArticle[] = [];
  for (const url of urls) {
    const meta = await enrichArticleFromPublisher(url);
    articles.push({
      url,
      title: meta.title,
      description: meta.description,
      domain: domainOf(url),
      sourcecountry: "United States",
    });
  }
  return { articles };
}

function unzipFirstFile(zip: Buffer): Buffer {
  const signature = zip.readUInt32LE(0);
  if (signature !== 0x04034b50) throw new Error("unsupported GDELT ZIP format");
  const compression = zip.readUInt16LE(8);
  const compressedSize = zip.readUInt32LE(18);
  const filenameLength = zip.readUInt16LE(26);
  const extraLength = zip.readUInt16LE(28);
  const start = 30 + filenameLength + extraLength;
  const compressed = zip.subarray(start, start + compressedSize);
  if (compression === 0) return compressed;
  if (compression === 8) return inflateRawSync(compressed);
  throw new Error(`unsupported GDELT ZIP compression: ${compression}`);
}

/**
 * Real I/O: calls the live GDELT DOC 2.0 API. No key required. Never called in
 * tests — tests inject a fixture-backed `FetchArticlesFn` instead.
 */
export async function fetchGdeltArticles(query: GrowthEventsQuery): Promise<unknown> {
  const url = new URL(GDELT_BASE_URL);
  url.searchParams.set("query", query.query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(query.maxRecords ?? 75));

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(DETECTOR_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`GDELT API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (err) {
    if (!query.recentGkgFiles) throw err;
    return fetchRecentGkgArticles(query.maxRecords ?? 25, query.recentGkgFiles);
  }
}
