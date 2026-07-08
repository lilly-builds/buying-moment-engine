import type { Detector, SignalCandidate } from "@/src/engine/detector";
import {
  adzunaSearchResponseSchema,
  fetchAdzunaJobs,
  normalizeJobToCandidate,
  ADZUNA_UNIT_COST_USD,
  type FetchJobsFn,
  type StaffingSpikeQuery,
} from "./staffing-spike-adzuna";

/**
 * U4 — front-desk staffing-spike detector (R3/R5/R7/R19). Source recon lives
 * in `staffing-spike.recon.md`: Adzuna Jobs API, a licensed developer API
 * (ToS-clean), chosen over CareerOneStop / Greenhouse-Lever / SerpAPI for the
 * best cost/volume trade covering small independent healthcare/dental/vet
 * practices. Detection: front-desk / phone / patient-access role phrases in
 * job posts (`staffing-spike-classifier.ts`, pure, precision-guarded against
 * clinical titles). Every emitted candidate cites the job post's own
 * `redirect_url` as evidence (R5).
 *
 * fetch -> normalize -> emit only; dedupe/freshness/persistence/error
 * isolation at the run level belong to the U3 framework
 * (`src/engine/detector.ts`, `jobs/run-detectors.ts`) — not re-implemented
 * here. This module's own `detect()` additionally never throws: a fetch
 * failure or a malformed response is caught, logged, and skipped so a run
 * never surfaces partial/garbage candidates (R7).
 */

/** Default keyword query — U15 should tune per-metro coverage against real yield. */
const DEFAULT_QUERIES: StaffingSpikeQuery[] = [
  { what: "patient coordinator front desk receptionist scheduler call center", page: 1 },
];

export interface StaffingSpikeDetectorOptions {
  /** Provider tag used in the detector `name` and the meter's `provider`. */
  source?: string;
  queries?: StaffingSpikeQuery[];
  unitCostUsd?: number;
}

/**
 * Build a staffing-spike detector with an injected fetcher, so tests supply a
 * recorded fixture and never need a live `ADZUNA_APP_KEY`.
 */
export function createStaffingSpikeDetector(
  fetchJobs: FetchJobsFn,
  options: StaffingSpikeDetectorOptions = {},
): Detector {
  const source = options.source ?? "adzuna";
  const queries = options.queries ?? DEFAULT_QUERIES;
  const unitCostUsd = options.unitCostUsd ?? ADZUNA_UNIT_COST_USD;

  return {
    kind: "staffing_spike",
    name: `staffing-spike:${source}`,

    async detect(ctx) {
      const candidates: SignalCandidate[] = [];

      for (const query of queries) {
        let raw: unknown;
        try {
          raw = ctx.meter
            ? await ctx.meter(
                {
                  provider: source,
                  operation: "jobs.search",
                  pipelineStep: "detect",
                  units: 1,
                  unitCostUsd,
                },
                () => fetchJobs(query),
              )
            : await fetchJobs(query);
        } catch (err) {
          console.warn("staffing-spike detector: fetch failed", {
            source,
            query,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        const parsed = adzunaSearchResponseSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn("staffing-spike detector: malformed jobs response", {
            source,
            query,
            issues: parsed.error.issues.map((i) => i.message),
          });
          continue;
        }

        for (const job of parsed.data.results) {
          const candidate = normalizeJobToCandidate(job, ctx.now);
          if (candidate) candidates.push(candidate);
        }
      }

      return candidates;
    },
  };
}

/** The registrable detector — the orchestrator wires this into the registry. */
export const staffingSpikeDetector: Detector = createStaffingSpikeDetector(fetchAdzunaJobs);
