import { z } from "zod";

/**
 * Google Places Text Search enumeration (U1) — the DISCOVERY half of the Places
 * source: turn `(ICP category, metro)` into a list of candidate practices, each
 * already carrying the `rating` + `user_ratings_total` the funnel needs, in ONE
 * call. Normalize is PURE (parsed Text Search JSON in, `PlaceCandidate[]` out) —
 * unit-testable with no mocks. `fetchPlacesTextSearch` is the only I/O here, and
 * it is thin by design: build the URL, fetch, hand back raw JSON for the caller
 * to validate (exactly as `phone-complaints-google-places.ts` does for Details).
 *
 * This file is the mirror image of `src/detectors/phone-complaints-google-places.ts`:
 * that module's per-place Details lookup is the ENRICHMENT half (reviews for an
 * already-known place_id); this is the ENUMERATION half that discovers those
 * place_ids in the first place. Both use the LEGACY endpoints deliberately (K9) —
 * Text Search (`/place/textsearch/json`) matches that file's Details call
 * (`/place/details/json`); a New-Places-API migration is a separate follow-up.
 *
 * Google ToS: Text Search returns only public listing facts (name, address,
 * rating, review COUNT) and never review TEXT, so nothing on this path brushes the
 * store-only-place_id rule the Details path enforces.
 */

const textSearchResultSchema = z.object({
  // Optional at the schema boundary so one malformed item in a 20-item page is
  // SKIPPED in normalize, not thrown for the whole page (a single junk row must
  // never cost us the other nineteen).
  place_id: z.string().optional(),
  name: z.string().optional(),
  formatted_address: z.string().optional(),
  rating: z.number().optional(),
  user_ratings_total: z.number().optional(),
  types: z.array(z.string()).optional(),
});

export const textSearchResponseSchema = z.object({
  status: z.string(),
  results: z.array(textSearchResultSchema).default([]),
  next_page_token: z.string().optional(),
});

export type TextSearchResult = z.output<typeof textSearchResultSchema>;
export type TextSearchResponse = z.output<typeof textSearchResponseSchema>;

/** One enumeration query: an ICP category searched within one metro. */
export interface TextSearchQuery {
  /** ICP category term — the subject of the Google query, e.g. "dermatology". */
  category: string;
  /** Human metro for the Google query + display, e.g. "Austin, TX". */
  metro: string;
  /** Stable resolver key derived from the metro, e.g. "austin-tx". */
  geoKey: string;
}

/**
 * What enumeration yields per place: enough to run the funnel and, downstream,
 * the Details lookup + practice resolution. `practiceHint` is the human name
 * (never a UUID/opaque id); `placeId` is the one identifier Google's ToS permits
 * storing long-lived.
 */
export interface PlaceCandidate {
  placeId: string;
  practiceHint: string;
  geoKey: string;
  /** null = Google returned no rating (unrated) — the funnel treats it as unknown. */
  rating: number | null;
  /** 0 when absent — how many ratings back the score. */
  reviewCount: number;
  address?: string;
}

/** Injected fetcher — tests supply a fixture; production calls the real API. */
export type FetchTextSearchFn = (query: TextSearchQuery) => Promise<unknown>;

/**
 * Stable geo key from a human metro string ("Austin, TX" -> "austin-tx"). This is
 * the EXACT-match key `resolvePractice` gates practice merging on, so every source
 * that discovers the same metro MUST derive it the same way. Kept here — next to
 * the only producer of geo-scoped candidates on the discovery path — and reused by
 * the tenant profile (U4) and the orchestrator (U5).
 */
export function metroToGeoKey(metro: string): string {
  return metro
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The Google `query` param, e.g. "dermatology in Austin, TX". */
export function textSearchQueryString(query: TextSearchQuery): string {
  return `${query.category} in ${query.metro}`;
}

/**
 * Pure normalize: one Text Search response -> the candidate places worth
 * considering. A non-OK status (`ZERO_RESULTS`, `INVALID_REQUEST`, …) yields `[]`.
 * A result missing `place_id` or `name` is SKIPPED — we cannot resolve a nameless
 * place to a practice, and dropping one junk row must not drop the rest.
 */
export function normalizeTextSearchResponse(
  response: TextSearchResponse,
  query: TextSearchQuery,
): PlaceCandidate[] {
  if (response.status !== "OK") return [];

  const candidates: PlaceCandidate[] = [];
  for (const result of response.results) {
    if (!result.place_id || !result.name) continue;
    const candidate: PlaceCandidate = {
      placeId: result.place_id,
      practiceHint: result.name,
      geoKey: query.geoKey,
      rating: result.rating ?? null,
      reviewCount: result.user_ratings_total ?? 0,
    };
    if (result.formatted_address) candidate.address = result.formatted_address;
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * The rating funnel (R2/K6): drop places rated AT OR ABOVE the tenant threshold
 * before any expensive per-place work. A well-loved practice is unlikely to be
 * sitting on the phone-access pain we hunt; the low-rated tail is where the signal
 * lives. An UNRATED place (Google returned no `rating`) is treated as UNKNOWN and
 * PASSES — we never silently drop a place we simply could not score; its reviews
 * decide it downstream. Text Search returns `rating` in the SAME call, so this
 * gate is nearly free and precedes the ~4¢ Details+LLM step (K6).
 */
export function passesRatingFunnel(
  candidate: PlaceCandidate,
  threshold: number,
): boolean {
  if (candidate.rating === null) return true;
  return candidate.rating < threshold;
}

const GOOGLE_PLACES_TEXTSEARCH_URL =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";

/**
 * Legacy "Text Search (Basic)" SKU. K8: this is the ~3.2¢ enumeration call,
 * distinct from the ~4¢ Details+Atmosphere (reviews) call in the Details path.
 * Confirm the billed tier on the Google console before scaling (origin doc's 🟡
 * pricing note); discovery makes many of these, so CAC accuracy depends on it.
 */
export const GOOGLE_TEXT_SEARCH_UNIT_COST_USD = 0.032;

/** Bounded network timeout — a hung upstream must not block the discovery run. */
export const TEXT_SEARCH_FETCH_TIMEOUT_MS = 10_000;

/**
 * Real I/O: calls the live Google Places Text Search API. Requires
 * `GOOGLE_PLACES_API_KEY`. Never called in tests — tests inject a fixture-backed
 * `FetchTextSearchFn` instead. Pagination: this returns page 1 (up to 20 results);
 * `next_page_token` is surfaced on the parsed response as a documented extension
 * point, not yet followed (Open Questions — decide from observed yield vs. cost).
 */
export async function fetchPlacesTextSearch(
  query: TextSearchQuery,
): Promise<unknown> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY not configured — live Text Search enumeration requires credentials (see bme-research-docs/docs/google-places-api-research.md)",
    );
  }

  const url = new URL(GOOGLE_PLACES_TEXTSEARCH_URL);
  url.searchParams.set("query", textSearchQueryString(query));
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(TEXT_SEARCH_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `Google Places Text Search error: ${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}
