import { and, eq } from "drizzle-orm";
import { discoveryCandidates, practices, signals } from "@/db/schema";
import type { Database } from "@/db/types";
import {
  ADZUNA_UNIT_COST_USD,
  adzunaSearchResponseSchema,
  fetchAdzunaJobs,
  normalizeJobToCandidate,
  type FetchJobsFn,
} from "@/src/detectors/staffing-spike-adzuna";
import {
  GDELT_UNIT_COST_USD,
  fetchGdeltArticles,
  gdeltSearchResponseSchema,
  normalizeArticleToCandidate,
  type FetchArticlesFn,
} from "@/src/detectors/growth-events-gdelt";
import {
  GOOGLE_PLACES_UNIT_COST_USD,
  fetchGooglePlaceDetails,
  googlePlaceDetailsResponseSchema,
  normalizePlaceReviewsToCandidate,
  type FetchPlaceDetailsFn,
} from "@/src/detectors/phone-complaints-google-places";
import type { DetectorKind } from "@/src/ingest/validate";
import type { Meter } from "@/src/roi/cost-meter";
import { computeExpiresAt } from "./freshness";
import { attachSignal, nameSimilarity, normalizeGeoKey } from "./resolver";

/**
 * Proactive signal cross-check (Thread 08/17): once a practice is qualified by
 * any source, query the other sources for THAT known clinic and attach any real,
 * cited signals that fire. Bounded by practice id, metered at the source call,
 * and idempotent through attachSignal's citation dedupe.
 */

const MATCH_THRESHOLD = 0.6;

export interface CrossCheckDeps {
  db: Database;
  meter: Meter;
  now: Date;
  fetchJobs?: FetchJobsFn;
  fetchArticles?: FetchArticlesFn;
  fetchPlaceDetails?: FetchPlaceDetailsFn;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}

export interface CrossCheckSummary {
  practiceId: string;
  practiceName: string;
  checked: DetectorKind[];
  attached: DetectorKind[];
  skipped: { kind: DetectorKind; reason: string }[];
}

function defaultLogger(event: string, meta?: Record<string, unknown>): void {
  console.warn(event, meta ?? {});
}

function quote(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

function practiceWhere(practice: { city: string | null; state: string | null; geoKey: string }): string | undefined {
  if (practice.city && practice.state) return `${practice.city}, ${practice.state}`;
  return undefined;
}

async function existingKinds(db: Database, practiceId: string): Promise<Set<DetectorKind>> {
  const rows = await db
    .select({ kind: signals.kind })
    .from(signals)
    .where(eq(signals.practiceId, practiceId));
  return new Set(rows.map((row) => row.kind));
}

export async function crossCheckSignals(
  deps: CrossCheckDeps,
  practiceId: string,
): Promise<CrossCheckSummary> {
  const log = deps.logger ?? defaultLogger;
  const fetchJobs = deps.fetchJobs ?? fetchAdzunaJobs;
  const fetchArticles = deps.fetchArticles ?? fetchGdeltArticles;
  const fetchPlaceDetails = deps.fetchPlaceDetails ?? fetchGooglePlaceDetails;

  const [practice] = await deps.db
    .select()
    .from(practices)
    .where(eq(practices.id, practiceId))
    .limit(1);
  if (!practice) throw new Error(`practice not found: ${practiceId}`);

  const summary: CrossCheckSummary = {
    practiceId,
    practiceName: practice.name,
    checked: [],
    attached: [],
    skipped: [],
  };
  const kinds = await existingKinds(deps.db, practiceId);

  async function attach(kind: DetectorKind, candidate: ReturnType<typeof normalizeJobToCandidate> | ReturnType<typeof normalizeArticleToCandidate> | ReturnType<typeof normalizePlaceReviewsToCandidate>) {
    if (!candidate) return;
    for (const atom of candidate.evidence) {
      await attachSignal(deps.db, {
        practiceId,
        kind,
        sourceUrl: atom.sourceUrl,
        snippet: atom.snippet ?? null,
        confidence: atom.confidence ?? candidate.confidence,
        detectedAt: candidate.detectedAt,
        expiresAt: computeExpiresAt(kind, candidate.detectedAt),
        signalSource: `crosscheck:${kind}`,
      });
    }
    summary.attached.push(kind);
  }

  // Staffing: paid/free-tier Adzuna search scoped by the known clinic name + metro.
  if (kinds.has("staffing_spike")) {
    summary.skipped.push({ kind: "staffing_spike", reason: "already-present" });
  } else {
    summary.checked.push("staffing_spike");
    try {
      const raw = await deps.meter(
        {
          provider: "adzuna",
          operation: "jobs.search",
          pipelineStep: "cross-check",
          practiceId,
          units: 1,
          unitCostUsd: ADZUNA_UNIT_COST_USD,
          meta: { practiceName: practice.name, where: practiceWhere(practice) ?? null },
        },
        () =>
          fetchJobs({
            what: practice.name,
            where: practiceWhere(practice),
            page: 1,
          }),
      );
      const parsed = adzunaSearchResponseSchema.safeParse(raw);
      if (!parsed.success) {
        summary.skipped.push({ kind: "staffing_spike", reason: "malformed-response" });
      } else {
        let attached = false;
        for (const job of parsed.data.results) {
          const candidate = normalizeJobToCandidate(job, deps.now);
          if (!candidate) continue;
          const jobMentionsPractice = `${job.title} ${job.description ?? ""}`
            .toLowerCase()
            .includes(practice.name.toLowerCase());
          const employerMatches =
            nameSimilarity(candidate.practiceHint, practice.name) >= MATCH_THRESHOLD;
          if (!jobMentionsPractice && !employerMatches) continue;
          // Adzuna often normalizes the employer to a parent company (for example
          // Ortholonestar) while the job title names the clinic. Because this was
          // queried by the exact clinic name and confirmed above, attach to the
          // resolved practice rather than creating a parent-company orphan.
          candidate.practiceHint = practice.name;
          candidate.geoKey = normalizeGeoKey(practice.geoKey);
          await attach("staffing_spike", candidate);
          attached = true;
        }
        if (!attached) summary.skipped.push({ kind: "staffing_spike", reason: "no-matching-job" });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log("crosscheck.staffing.error", { practiceId, error });
      summary.skipped.push({ kind: "staffing_spike", reason: "fetch-error" });
    }
  }

  // Growth: keyless GDELT search targeted to the known clinic name.
  if (kinds.has("growth_events")) {
    summary.skipped.push({ kind: "growth_events", reason: "already-present" });
  } else {
    summary.checked.push("growth_events");
    try {
      const raw = await deps.meter(
        {
          provider: "gdelt",
          operation: "news.search",
          pipelineStep: "cross-check",
          practiceId,
          units: 1,
          unitCostUsd: GDELT_UNIT_COST_USD,
          meta: { practiceName: practice.name },
        },
        () =>
          fetchArticles({
            query: `${quote(practice.name)} (acquired OR acquisition OR "private equity" OR merger OR "opens new location" OR "opens second location" OR expansion OR "adds new provider" OR "welcomes new provider")`,
            maxRecords: 25,
          }),
      );
      const parsed = gdeltSearchResponseSchema.safeParse(raw);
      if (!parsed.success) {
        summary.skipped.push({ kind: "growth_events", reason: "malformed-response" });
      } else {
        let attached = false;
        for (const article of parsed.data.articles) {
          const candidate = normalizeArticleToCandidate(article, deps.now);
          if (!candidate) continue;
          const titleMentionsPractice = article.title
            .toLowerCase()
            .includes(practice.name.toLowerCase());
          const namesMatch = nameSimilarity(candidate.practiceHint, practice.name) >= MATCH_THRESHOLD;
          if (!titleMentionsPractice && !namesMatch) continue;
          candidate.geoKey = normalizeGeoKey(practice.geoKey);
          await attach("growth_events", candidate);
          attached = true;
        }
        if (!attached) summary.skipped.push({ kind: "growth_events", reason: "no-matching-article" });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log("crosscheck.growth.error", { practiceId, error });
      summary.skipped.push({ kind: "growth_events", reason: "fetch-error" });
    }
  }

  // Phone complaints: only run when we already have a permitted Google place_id
  // for this same practice from the discovery archive/cache lane.
  if (kinds.has("phone_complaints")) {
    summary.skipped.push({ kind: "phone_complaints", reason: "already-present" });
  } else {
    const candidates = await deps.db
      .select()
      .from(discoveryCandidates)
      .where(and(eq(discoveryCandidates.geoKey, normalizeGeoKey(practice.geoKey)), eq(discoveryCandidates.lastVerdict, "qualified")));
    const place = candidates.find(
      (candidate) => nameSimilarity(candidate.name, practice.name) >= MATCH_THRESHOLD,
    );
    if (!place) {
      summary.skipped.push({ kind: "phone_complaints", reason: "no-known-place-id" });
    } else {
      summary.checked.push("phone_complaints");
      try {
        const raw = await deps.meter(
          {
            provider: "google-places",
            operation: "place-details+reviews",
            pipelineStep: "cross-check",
            practiceId,
            units: 1,
            unitCostUsd: GOOGLE_PLACES_UNIT_COST_USD,
            meta: { placeId: place.placeId },
          },
          () =>
            fetchPlaceDetails({
              practiceHint: practice.name,
              placeId: place.placeId,
              geoKey: normalizeGeoKey(practice.geoKey),
            }),
        );
        const parsed = googlePlaceDetailsResponseSchema.safeParse(raw);
        if (!parsed.success) {
          summary.skipped.push({ kind: "phone_complaints", reason: "malformed-response" });
        } else {
          const candidate = normalizePlaceReviewsToCandidate(parsed.data, {
            practiceHint: practice.name,
            placeId: place.placeId,
            geoKey: normalizeGeoKey(practice.geoKey),
          }, deps.now);
          if (candidate) await attach("phone_complaints", candidate);
          else summary.skipped.push({ kind: "phone_complaints", reason: "no-phone-complaint" });
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log("crosscheck.phone.error", { practiceId, error });
        summary.skipped.push({ kind: "phone_complaints", reason: "fetch-error" });
      }
    }
  }

  return summary;
}
