import type { Detector, SignalCandidate } from "@/src/engine/detector";
import {
  googlePlaceDetailsResponseSchema,
  fetchGooglePlaceDetails,
  normalizePlaceReviewsToCandidate,
  GOOGLE_PLACES_UNIT_COST_USD,
  type FetchPlaceDetailsFn,
  type PhoneComplaintsQuery,
} from "./phone-complaints-google-places";

/**
 * U4 — phone-complaints reviews detector (R3/R5/R7/R19). Source recon lives
 * in `phone-complaints.recon.md`: Google Places API, chosen over Yelp Fusion
 * (paid, thinner excerpt cap) and a licensed review-data provider (named as
 * the U15 fallback once Google's ~5-review-per-place ceiling proves too
 * thin). Detection: acute, self-reported phone-access failure phrases in
 * review text (`phone-complaints-classifier.ts`, pure, precision-guarded so
 * a review merely mentioning the phone positively never flags). Every
 * emitted candidate cites the place's own Google Maps URL as evidence (R5).
 *
 * Google's ToS bars storing review content beyond `place_id` — honored in
 * `normalizePlaceReviewsToCandidate`, which never emits a `snippet` and folds
 * only the place_id + our own closed-vocabulary category into `claim`.
 *
 * fetch -> normalize -> emit only; dedupe/freshness/persistence/error
 * isolation at the run level belong to the U3 framework
 * (`src/engine/detector.ts`, `jobs/run-detectors.ts`) — not re-implemented
 * here. This module's own `detect()` additionally never throws: a fetch
 * failure or a malformed response is caught, logged, and skipped so a run
 * never surfaces partial/garbage candidates (R7).
 *
 * Unlike its staffing-spike sibling (a broad keyword search that discovers
 * unknown employers), Google Places is a per-place lookup: there is no
 * sensible global default query. The exported `phoneComplaintsDetector`
 * therefore ships with an EMPTY query list — the orchestrator supplies the
 * real per-practice `{ practiceHint, placeId }` pairs after merge, from its
 * own list of known customers.
 */

export interface PhoneComplaintsDetectorOptions {
  /** Provider tag used in the detector `name` and the meter's `provider`. */
  source?: string;
  unitCostUsd?: number;
}

/**
 * Build a phone-complaints detector with an injected fetcher and an explicit
 * per-practice query list, so tests supply a recorded fixture and never need
 * a live `GOOGLE_PLACES_API_KEY`.
 */
export function createPhoneComplaintsDetector(
  fetchPlaceDetails: FetchPlaceDetailsFn,
  queries: PhoneComplaintsQuery[] = [],
  options: PhoneComplaintsDetectorOptions = {},
): Detector {
  const source = options.source ?? "google-places";
  const unitCostUsd = options.unitCostUsd ?? GOOGLE_PLACES_UNIT_COST_USD;

  return {
    kind: "phone_complaints",
    name: `phone-complaints:${source}`,

    async detect(ctx) {
      const candidates: SignalCandidate[] = [];

      for (const query of queries) {
        let raw: unknown;
        try {
          raw = ctx.meter
            ? await ctx.meter(
                {
                  provider: source,
                  operation: "place-details+reviews",
                  pipelineStep: "detect",
                  units: 1,
                  unitCostUsd,
                },
                () => fetchPlaceDetails(query),
              )
            : await fetchPlaceDetails(query);
        } catch (err) {
          console.warn("phone-complaints detector: fetch failed", {
            source,
            placeId: query.placeId,
            practiceHint: query.practiceHint,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        const parsed = googlePlaceDetailsResponseSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn("phone-complaints detector: malformed place-details response", {
            source,
            placeId: query.placeId,
            issues: parsed.error.issues.map((i) => i.message),
          });
          continue;
        }

        const candidate = normalizePlaceReviewsToCandidate(parsed.data, query, ctx.now);
        if (candidate) candidates.push(candidate);
      }

      return candidates;
    },
  };
}

/**
 * The registrable detector — the orchestrator wires this into the registry
 * (and supplies the real per-practice query list; see the empty-default note
 * above). Do not add a default query list here: unlike a keyword search,
 * a made-up default place_id would either fail or point at the wrong
 * business.
 */
export const phoneComplaintsDetector: Detector = createPhoneComplaintsDetector(
  fetchGooglePlaceDetails,
);
