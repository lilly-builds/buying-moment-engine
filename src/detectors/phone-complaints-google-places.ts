import { z } from "zod";
import type { CandidateEvidence, SignalCandidate } from "@/src/engine/detector";
import { classifyPhoneComplaint } from "./phone-complaints-classifier";

/**
 * Google Places adapter for U4 (see `phone-complaints.recon.md` for the
 * source decision + ToS basis). Normalize is PURE (parsed place-details JSON
 * in, `SignalCandidate | null` out) — unit-testable with no mocks.
 * `fetchGooglePlaceDetails` is the only I/O here, and it is thin by design:
 * build the URL, fetch, return raw JSON for the caller to validate.
 *
 * Google's Places ToS bars storing review CONTENT beyond `place_id` (see the
 * recon memo's evidence-storage-rule section) — `normalizePlaceReviewsToCandidate`
 * is the one place that rule is enforced: it never sets `snippet` on an
 * emitted evidence atom, and the `claim` string carries only the practice's
 * `place_id` plus the classifier's own closed-vocabulary category, never the
 * review's own words.
 */

const googlePlaceReviewSchema = z.object({
  author_name: z.string().optional(),
  rating: z.number().optional(),
  text: z.string(),
  relative_time_description: z.string().optional(),
  time: z.number().optional(),
});

export const googlePlaceDetailsResponseSchema = z.object({
  status: z.string(),
  result: z
    .object({
      place_id: z.string(),
      name: z.string().optional(),
      url: z.url().optional(),
      reviews: z.array(googlePlaceReviewSchema).optional(),
    })
    .optional(),
});

export type GooglePlaceReview = z.output<typeof googlePlaceReviewSchema>;
export type GooglePlaceDetailsResponse = z.output<typeof googlePlaceDetailsResponseSchema>;

/**
 * One practice to check — Google has no notion of "our customer," so the
 * caller (the orchestrator, wired in after merge) supplies the already-known
 * `place_id` per practice alongside its human `practiceHint`, rather than
 * this detector discovering practices via a keyword search.
 */
export interface PhoneComplaintsQuery {
  /** Human practice name — never a UUID/opaque id. Becomes `SignalCandidate.practiceHint`. */
  practiceHint: string;
  /** Google's opaque place identifier — the one thing Google's ToS permits storing long-lived. */
  placeId: string;
  geoKey?: string;
}

/** Injected fetcher — tests supply a fixture; production calls the real API. */
export type FetchPlaceDetailsFn = (query: PhoneComplaintsQuery) => Promise<unknown>;

/**
 * Below this many retrievable reviews, Google Places alone is too sparse a
 * sample to trust a phone-complaint verdict for that practice (see the recon
 * memo's minimum-yield-threshold section). The detector still processes
 * whatever is available below this floor — it degrades gracefully, it never
 * throws — but logs so an operator/U15 can route thin practices to the
 * licensed-provider fallback instead of trusting a sparse Google sample.
 */
export const GOOGLE_PLACES_MIN_YIELD_THRESHOLD = 3;

function googleMapsUrlFromPlaceId(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
}

/**
 * Pure normalize: one place-details response -> one `SignalCandidate`, or
 * `null` when the place lookup failed (non-OK status) or no review flagged
 * as a phone complaint (R7 precision guard, delegated to the classifier).
 */
export function normalizePlaceReviewsToCandidate(
  response: GooglePlaceDetailsResponse,
  query: PhoneComplaintsQuery,
  now: Date,
): SignalCandidate | null {
  if (response.status !== "OK" || !response.result) return null;

  const reviews = response.result.reviews ?? [];
  if (reviews.length < GOOGLE_PLACES_MIN_YIELD_THRESHOLD) {
    console.warn("phone-complaints detector: Google Places yield below minimum threshold", {
      placeId: query.placeId,
      practiceHint: query.practiceHint,
      reviewCount: reviews.length,
      threshold: GOOGLE_PLACES_MIN_YIELD_THRESHOLD,
    });
  }

  const placeUrl = response.result.url ?? googleMapsUrlFromPlaceId(query.placeId);

  // Aggregate across all flagged reviews into ONE evidence atom. Every atom
  // here would share this place's single `sourceUrl`, so the framework's
  // `kind|sourceUrl|practiceHint` dedupe (src/engine/detector.ts) collapses
  // same-URL atoms to one raw signal at ingest — emitting one atom per review
  // silently drops N-1 and keeps the FIRST review's confidence, not the max.
  // Emit one atom carrying the max confidence + a count/category summary.
  let flaggedCount = 0;
  let maxConfidence = 0;
  const categories = new Set<string>();

  for (const review of reviews) {
    const classification = classifyPhoneComplaint(review.text);
    if (!classification.isPhoneComplaint) continue;

    flaggedCount += 1;
    maxConfidence = Math.max(maxConfidence, classification.confidence);
    if (classification.category) categories.add(classification.category);
  }

  if (flaggedCount === 0) return null;

  const sortedCategories = [...categories].sort();
  const reviewWord = flaggedCount === 1 ? "review" : "reviews";

  const evidence: CandidateEvidence[] = [
    {
      // R5 citation + Google ToS: never store review text. The claim carries
      // only the place_id (the field Google permits storing long-lived), the
      // count of flagged reviews, and our own closed-vocabulary categories —
      // never a word of any review. No `snippet` on this path.
      claim: `Phone-access complaints detected in ${flaggedCount} Google ${reviewWord} for place_id "${query.placeId}" (categories: ${sortedCategories.join(", ")})`,
      sourceUrl: placeUrl,
      confidence: maxConfidence,
    },
  ];

  const candidate: SignalCandidate = {
    practiceHint: query.practiceHint,
    kind: "phone_complaints",
    confidence: maxConfidence,
    detectedAt: now,
    evidence,
  };
  if (query.geoKey) candidate.geoKey = query.geoKey;
  return candidate;
}

const GOOGLE_PLACES_BASE_URL = "https://maps.googleapis.com/maps/api/place/details/json";
/** Places API "Atmosphere Data" SKU (includes reviews) — confirm actual billed tier before scaling (U15). */
export const GOOGLE_PLACES_UNIT_COST_USD = 0.005;
/** Bounded network timeout — a hung upstream must not block the sequential detector cron. */
export const DETECTOR_FETCH_TIMEOUT_MS = 10_000;

/**
 * Real I/O: calls the live Google Places Details API. Requires
 * `GOOGLE_PLACES_API_KEY` (see recon memo). Never called in tests — tests
 * inject a fixture-backed `FetchPlaceDetailsFn` instead.
 */
export async function fetchGooglePlaceDetails(query: PhoneComplaintsQuery): Promise<unknown> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY not configured — live phone-complaints fetch requires credentials (see phone-complaints.recon.md, U15)",
    );
  }

  const url = new URL(GOOGLE_PLACES_BASE_URL);
  url.searchParams.set("place_id", query.placeId);
  url.searchParams.set("fields", "place_id,name,url,reviews");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(DETECTOR_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Google Places API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
