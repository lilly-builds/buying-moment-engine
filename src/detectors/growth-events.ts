import type { Detector, SignalCandidate } from "@/src/engine/detector";
import {
  gdeltSearchResponseSchema,
  fetchGdeltArticles,
  normalizeArticleToCandidate,
  GDELT_UNIT_COST_USD,
  type FetchArticlesFn,
  type GrowthEventsQuery,
} from "./growth-events-gdelt";

/**
 * U4 — growth-events detector (R3/R5/R7/R19). Source recon lives in
 * `growth-events.recon.md`: GDELT DOC 2.0, a free keyless global news index
 * (ToS-clean), chosen as the primary lead over a paid news API (optional
 * supplement, not built here) and over Google Business (no official
 * third-party monitoring path — explicitly not led with, per the plan).
 * Detection: a PE-deal / acquisition / merger / expansion news article that
 * NAMES a healthcare practice (`growth-events-classifier.ts`, pure,
 * precision-guarded — requires BOTH a growth-event phrase and an extractable
 * practice name). Every emitted candidate cites the article's own `url` as
 * evidence (R5).
 *
 * fetch -> normalize -> emit only; dedupe/freshness/persistence/error
 * isolation at the run level belong to the U3 framework
 * (`src/engine/detector.ts`, `jobs/run-detectors.ts`) — not re-implemented
 * here. This module's own `detect()` additionally never throws: a fetch
 * failure or a malformed response is caught, logged, and skipped so a run
 * never surfaces partial/garbage candidates (R7).
 */

/** Default query — U15 should tune per-metro coverage and phrase list against real yield. */
const DEFAULT_QUERIES: GrowthEventsQuery[] = [
  {
    query:
      '(acquires OR "acquired by" OR "private equity" OR merger OR "opens new location" OR "opens second location" OR expansion) (dental OR dermatology OR veterinary OR orthodontics OR "medical group" OR clinic OR "urgent care" OR "family practice")',
    maxRecords: 75,
  },
];

export interface GrowthEventsDetectorOptions {
  /** Provider tag used in the detector `name` and the meter's `provider`. */
  source?: string;
  queries?: GrowthEventsQuery[];
  unitCostUsd?: number;
}

/**
 * Build a growth-events detector with an injected fetcher, so tests supply a
 * recorded fixture and never need a live network call (GDELT needs no key at
 * all, but the fetcher is still injected for determinism and error-path tests).
 */
export function createGrowthEventsDetector(
  fetchArticles: FetchArticlesFn,
  options: GrowthEventsDetectorOptions = {},
): Detector {
  const source = options.source ?? "gdelt";
  const queries = options.queries ?? DEFAULT_QUERIES;
  const unitCostUsd = options.unitCostUsd ?? GDELT_UNIT_COST_USD;

  return {
    kind: "growth_events",
    name: `growth-events:${source}`,

    async detect(ctx) {
      const candidates: SignalCandidate[] = [];

      for (const query of queries) {
        let raw: unknown;
        try {
          raw = ctx.meter
            ? await ctx.meter(
                {
                  provider: source,
                  operation: "news.search",
                  pipelineStep: "detect",
                  units: 1,
                  unitCostUsd,
                },
                () => fetchArticles(query),
              )
            : await fetchArticles(query);
        } catch (err) {
          console.warn("growth-events detector: fetch failed", {
            source,
            query,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        const parsed = gdeltSearchResponseSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn("growth-events detector: malformed news response", {
            source,
            query,
            issues: parsed.error.issues.map((i) => i.message),
          });
          continue;
        }

        for (const article of parsed.data.articles) {
          const candidate = normalizeArticleToCandidate(article, ctx.now);
          if (candidate) candidates.push(candidate);
        }
      }

      return candidates;
    },
  };
}

/** The registrable detector — the orchestrator wires this into the registry. */
export const growthEventsDetector: Detector = createGrowthEventsDetector(fetchGdeltArticles);
