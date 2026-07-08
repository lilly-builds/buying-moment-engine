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

/**
 * Pure normalize: one GDELT article -> one `SignalCandidate`, or `null` when
 * the title isn't a growth event or doesn't name an attributable practice
 * (R7 precision guard, delegated to the classifier).
 */
export function normalizeArticleToCandidate(
  article: GdeltArticle,
  now: Date,
): SignalCandidate | null {
  const classification = classifyGrowthEvent(article.title);
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
        confidence: classification.confidence,
      },
    ],
  };

  if (article.sourcecountry) candidate.geoKey = slugifyGeo(article.sourcecountry);
  return candidate;
}

const GDELT_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
/** Keyless, free-tier API today — metered at $0 for a complete R19 ledger (see recon memo). */
export const GDELT_UNIT_COST_USD = 0;
/** Bounded network timeout — a hung upstream must not block the sequential detector cron. */
export const DETECTOR_FETCH_TIMEOUT_MS = 10_000;

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

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(DETECTOR_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`GDELT API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
