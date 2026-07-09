import { z } from "zod";
import { nameSimilarity } from "@/src/engine/resolver";
import {
  fetchPlacesTextSearch,
  GOOGLE_TEXT_SEARCH_UNIT_COST_USD,
  metroToGeoKey,
  normalizeTextSearchResponse,
  textSearchResponseSchema,
  TEXT_SEARCH_FETCH_TIMEOUT_MS,
  type FetchTextSearchFn,
  type TextSearchQuery,
} from "@/src/discovery/places-search";
import type { Meter } from "@/src/roi/cost-meter";

/**
 * Plan B — deliberate website search (R-W2). When a practice reaches enrichment
 * with NO website on file (its lead source did not hand one over — Adzuna/GDELT, or
 * a practice discovered before Plan A captured it), find the homepage by NAME via
 * Google Places, so the scrape path can still read the real site. This is also the
 * retroactive backfill for practices already in the DB: the first seeding run over
 * them fills their `website_url` here.
 *
 * "Source-first, search as Plan B": the conductor calls this ONLY when the source
 * gave us nothing, so a website captured at the source (Plan A) is never re-bought.
 *
 * Two paid Places calls, each metered at its call site (R19): a Text Search to find
 * the place, then a Details lookup for its `website`. NEVER throws — a lookup that
 * fails or is ambiguous returns `null`, the practice keeps its gap, and enrichment
 * degrades honestly rather than crashing the batch. Both fetchers are injected, so
 * this unit-tests against fixtures with zero live calls.
 */

const PIPELINE_STEP = "enrich.website";

/** Place Details requesting only the website — the Contact-Data field category. */
const placeWebsiteResponseSchema = z.object({
  status: z.string(),
  result: z
    .object({
      place_id: z.string().optional(),
      name: z.string().optional(),
      website: z.url().optional(),
    })
    .optional(),
});

/**
 * Below this name overlap between the query and Google's best match, treat the
 * result as a DIFFERENT business and return null rather than a wrong website — a
 * wrong homepage would send the scraper to the wrong practice. Looser than the
 * resolver's 0.6 merge gate: Google reformats names ("Sanova Dermatology" ->
 * "Sanova Dermatology | Austin - North Austin"), so an exact-token match is too
 * strict, but a near-zero overlap (an unrelated business) must still be rejected.
 */
export const WEBSITE_NAME_MATCH_THRESHOLD = 0.4;

const GOOGLE_PLACES_DETAILS_URL =
  "https://maps.googleapis.com/maps/api/place/details/json";

/** Conservative estimate for a Details call carrying `website` (Contact Data SKU); confirm billed tier (U15). */
export const GOOGLE_PLACES_WEBSITE_UNIT_COST_USD = 0.017;

/** Injected fetcher for the website Details lookup — tests supply a fixture. */
export type FetchPlaceWebsiteFn = (query: { placeId: string }) => Promise<unknown>;

export interface WebsiteLookupDeps {
  meter: Meter;
  /** Defaults to the live Places Text Search; injected as a fixture in tests. */
  fetchTextSearch?: FetchTextSearchFn;
  /** Defaults to the live Details-for-website lookup; injected as a fixture in tests. */
  fetchPlaceWebsite?: FetchPlaceWebsiteFn;
  practiceId?: string | null;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}

export interface WebsiteQuery {
  name: string;
  city?: string | null;
  state?: string | null;
  geoKey?: string | null;
}

function defaultLogger(event: string, meta?: Record<string, unknown>): void {
  console.warn(event, meta ?? {});
}

/**
 * Real I/O: Place Details requesting only `website` (+ id/name). Requires
 * `GOOGLE_PLACES_API_KEY`. Never called in tests — a fixture-backed fetcher is
 * injected instead.
 */
export async function fetchPlaceWebsiteDetails(query: {
  placeId: string;
}): Promise<unknown> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY not configured — live website lookup requires credentials",
    );
  }
  const url = new URL(GOOGLE_PLACES_DETAILS_URL);
  url.searchParams.set("place_id", query.placeId);
  url.searchParams.set("fields", "place_id,name,website");
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(TEXT_SEARCH_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Google Places Details error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** The Google query metro string, e.g. "Austin, TX" (empty when neither is known). */
function metroOf(query: WebsiteQuery): string {
  return [query.city, query.state].filter(Boolean).join(", ");
}

/**
 * Find a practice's homepage by name via Google Places. Returns the website, or
 * `null` when nothing matches confidently. Never throws.
 */
export async function resolvePracticeWebsite(
  deps: WebsiteLookupDeps,
  query: WebsiteQuery,
): Promise<string | null> {
  const log = deps.logger ?? defaultLogger;
  const fetchTextSearch = deps.fetchTextSearch ?? fetchPlacesTextSearch;
  const fetchWebsite = deps.fetchPlaceWebsite ?? fetchPlaceWebsiteDetails;

  const metro = metroOf(query);
  const textQuery: TextSearchQuery = {
    // The practice name IS the subject of the search; the metro narrows it.
    category: query.name,
    metro,
    geoKey: query.geoKey ?? (metro ? metroToGeoKey(metro) : "unknown"),
  };

  try {
    const rawSearch = await deps.meter(
      {
        provider: "google_places",
        operation: "website.textsearch",
        pipelineStep: PIPELINE_STEP,
        practiceId: deps.practiceId ?? null,
        units: 1,
        unitCostUsd: GOOGLE_TEXT_SEARCH_UNIT_COST_USD,
        meta: { name: query.name, metro },
      },
      () => fetchTextSearch(textQuery),
    );

    const parsedSearch = textSearchResponseSchema.safeParse(rawSearch);
    if (!parsedSearch.success) {
      log("website.search_unparseable", { name: query.name });
      return null;
    }
    const candidates = normalizeTextSearchResponse(parsedSearch.data, textQuery);
    const best = candidates[0];
    if (!best) return null;

    // Guard against Google returning an unrelated business (Plan B risk).
    const similarity = nameSimilarity(query.name, best.practiceHint);
    if (similarity < WEBSITE_NAME_MATCH_THRESHOLD) {
      log("website.name_mismatch", {
        query: query.name,
        matched: best.practiceHint,
        similarity,
      });
      return null;
    }

    const rawDetails = await deps.meter(
      {
        provider: "google_places",
        operation: "website.details",
        pipelineStep: PIPELINE_STEP,
        practiceId: deps.practiceId ?? null,
        units: 1,
        unitCostUsd: GOOGLE_PLACES_WEBSITE_UNIT_COST_USD,
        meta: { placeId: best.placeId, name: query.name },
      },
      () => fetchWebsite({ placeId: best.placeId }),
    );

    const parsedDetails = placeWebsiteResponseSchema.safeParse(rawDetails);
    if (!parsedDetails.success || parsedDetails.data.status !== "OK") return null;
    return parsedDetails.data.result?.website ?? null;
  } catch (err) {
    // A thrown Places call (timeout, non-2xx, DNS) must not sink enrichment — the
    // practice simply keeps its website gap and the brief renders what it can.
    log("website.lookup_failed", {
      name: query.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
